import { ModelConfig } from '../types';

const IFYTEK_REALTIME_ENDPOINT = 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1';

interface LiveStreamCallbacks {
  onStatus?: (status: 'connecting' | 'connected' | 'streaming' | 'ended' | 'error') => void;
  onUpdate?: (payload: { text: string; isFinal: boolean; segmentId?: number; raw: unknown }) => void;
  onError?: (message: string) => void;
}

export interface LiveTranscriptionSession {
  start: () => Promise<void>;
  stop: () => void;
  isActive: () => boolean;
}

function formatUtc(now: Date): string {
  const pad = (num: number) => num.toString().padStart(2, '0');
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  const offsetMinutes = -now.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetMins = pad(Math.abs(offsetMinutes) % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}${offsetMins}`;
}

async function generateSignature(params: Record<string, string>, secret: string): Promise<string> {
  const sortedKeys = Object.keys(params).filter(key => key !== 'signature').sort();
  const encoder = new TextEncoder();
  const baseString = sortedKeys
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const keyData = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(baseString));
  const signatureBytes = new Uint8Array(signatureBuffer);
  let binary = '';
  signatureBytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function parseResultText(payload: any): string {
  const segments = payload?.cn?.st?.rt ?? [];
  const parts: string[] = [];
  
  for (const segment of segments) {
    const ws = segment?.ws ?? [];
    for (const word of ws) {
      const cw = word?.cw ?? [];
      for (const candidate of cw) {
        if (typeof candidate?.w === 'string') {
          parts.push(candidate.w);
        }
      }
    }
  }
  
  return parts.join('');
}

// 将音频数据转换为PCM格式
function audioBufferToPCM16(audioBuffer: AudioBuffer): ArrayBuffer {
  const samples = audioBuffer.getChannelData(0);
  const pcm16 = new Int16Array(samples.length);
  
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  
  return pcm16.buffer;
}

export function createLiveTranscriptionSession(
  config: ModelConfig,
  callbacks: LiveStreamCallbacks = {}
): LiveTranscriptionSession {
  let ws: WebSocket | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let audioWorkletNode: AudioWorkletNode | null = null;
  let isActive = false;
  let streamStarted = false;
  let sessionId = '';
  let segments = new Map<number, string>();
  let lastCompleteText = '';

  const { onStatus, onUpdate, onError } = callbacks;

  const cleanup = () => {
    console.log('[LiveTranscription] Cleaning up...');
    isActive = false;
    streamStarted = false;
    segments.clear();
    
    if (audioWorkletNode) {
      audioWorkletNode.disconnect();
      audioWorkletNode = null;
    }
    if (source) {
      source.disconnect();
      source = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder = null;
    }
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close();
      ws = null;
    }
  };

  const connectWebSocket = async (): Promise<void> => {
    console.log('[LiveTranscription] Connecting to WebSocket...');
    onStatus?.('connecting');

    sessionId = crypto.randomUUID();
    const now = new Date();
    
    const params: Record<string, string> = {
      accessKeyId: config.accessKeyId,
      appId: config.appId,
      uuid: sessionId,
      utc: formatUtc(now),
      lang: config.defaultLang ?? 'autodialect',
      audio_encode: config.audioEncode ?? 'pcm_s16le',
      samplerate: String(config.sampleRate ?? 16000),
    };

    const signature = await generateSignature(params, config.accessKeySecret);
    params.signature = signature;

    const queryString = new URLSearchParams(params).toString();
    const url = `${IFYTEK_REALTIME_ENDPOINT}?${queryString}`;
    
    console.log('[LiveTranscription] WebSocket URL:', url);

    return new Promise((resolve, reject) => {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('[LiveTranscription] WebSocket connected');
        onStatus?.('connected');
        
        // 立即开始流式发送，不等待服务端确认
        console.log('[LiveTranscription] Starting streaming immediately after connection');
        streamStarted = true;
        onStatus?.('streaming');
        
        resolve();
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          console.log('[LiveTranscription] Received non-string message:', event.data);
          return;
        }

        try {
          const data = JSON.parse(event.data);
          console.log('[LiveTranscription] Received message:', JSON.stringify(data, null, 2));

          // 处理started事件 - 支持多种格式
          if (data.action === 'started' || data.code === '0' || data.desc === 'success') {
            console.log('[LiveTranscription] Session started, beginning audio streaming');
            streamStarted = true;
            onStatus?.('streaming');
            return;
          }

          // 处理错误
          if (data.action === 'error' || (data.code && data.code !== '0')) {
            const message = data.desc || data.data?.desc || `服务返回错误 (code: ${data.code})`;
            console.error('[LiveTranscription] Server error:', message, data);
            onError?.(message);
            cleanup();
            return;
          }

          // 处理ASR结果
          if (data.msg_type === 'result' && data.res_type === 'asr') {
            console.log('[LiveTranscription] ASR result received:', data.data);
            const text = parseResultText(data.data);
            console.log('[LiveTranscription] Parsed text:', text);
            
            const isFinal = Boolean(data.data?.ls);
            const segmentId = data.data?.seg_id;

            if (text) { // 只有当有文本时才更新
              // 清理文本，移除开头的句号和其他符号
              const cleanedText = text.replace(/^[。，、；：！？\.,;:!?]+/, '');
              
              if (typeof segmentId === 'number') {
                let finalText = '';
                
                if (isFinal) {
                  // 最终结果：永久保存到segments
                  segments.set(segmentId, cleanedText);
                  finalText = Array.from(segments.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([, value]) => value)
                    .join('');
                } else {
                  // 临时结果：显示已确认文本 + 当前临时文本，但不保存
                  const confirmedText = Array.from(segments.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([, value]) => value)
                    .join('');
                  finalText = confirmedText + cleanedText;
                }
                
                console.log('[LiveTranscription] Segment', segmentId, 'text:', cleanedText, 'isFinal:', isFinal);
                console.log('[LiveTranscription] Complete text:', finalText);
                onUpdate?.({ text: finalText, isFinal, segmentId, raw: data });
              } else {
                // 没有segmentId的情况，直接使用清理后的文本
                console.log('[LiveTranscription] Direct text update:', cleanedText);
                onUpdate?.({ text: cleanedText, isFinal, segmentId, raw: data });
              }
            }
          } else {
            console.log('[LiveTranscription] Unknown message type:', data);
          }
        } catch (error) {
          console.error('[LiveTranscription] Failed to parse message:', error, 'Raw data:', event.data);
        }
      };

      ws.onerror = (error) => {
        console.error('[LiveTranscription] WebSocket error:', error);
        onError?.('连接失败');
        reject(error);
        cleanup();
      };

      ws.onclose = (event) => {
        console.log('[LiveTranscription] WebSocket closed:', event.code, event.reason);
        if (isActive) {
          onStatus?.('ended');
          cleanup();
        }
      };

      // 连接超时
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          reject(new Error('连接超时'));
        }
      }, 10000);
    });
  };

  const startAudioCapture = async (): Promise<void> => {
    console.log('[LiveTranscription] Starting audio capture...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: config.sampleRate ?? 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });

      console.log('[LiveTranscription] Microphone access granted');

      audioContext = new AudioContext({
        sampleRate: config.sampleRate ?? 16000
      });

      // 确保AudioContext处于运行状态
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // 加载AudioWorklet处理器
      try {
        await audioContext.audioWorklet.addModule('/audio-processor.js');
      } catch (error) {
        console.error('[LiveTranscription] Failed to load audio worklet:', error);
        throw new Error('无法加载音频处理模块');
      }

      source = audioContext.createMediaStreamSource(stream);
      audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');

      console.log('[LiveTranscription] Audio context created, state:', audioContext.state);

      // 监听来自AudioWorklet的消息
      audioWorkletNode.port.onmessage = (event) => {
        if (!streamStarted || !ws || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const { type, buffer, samples } = event.data;
        
        if (type === 'audioData') {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(buffer);
            console.log('[LiveTranscription] Sent audio chunk:', buffer.byteLength, 'bytes, samples:', samples);
          }
        }
      };

      // 连接音频节点
      source.connect(audioWorkletNode);
      // 不要连接到destination，避免回声

      console.log('[LiveTranscription] Audio capture started successfully with AudioWorklet');
    } catch (error) {
      console.error('[LiveTranscription] Failed to start audio capture:', error);
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          onError?.('麦克风访问被拒绝，请允许浏览器访问麦克风');
        } else if (error.name === 'NotFoundError') {
          onError?.('未找到麦克风设备');
        } else {
          onError?.(`麦克风访问失败: ${error.message}`);
        }
      } else {
        onError?.('无法访问麦克风');
      }
      throw error;
    }
  };

  const start = async (): Promise<void> => {
    if (isActive) {
      console.warn('[LiveTranscription] Session already active');
      return;
    }

    try {
      isActive = true;
      segments.clear();
      
      await connectWebSocket();
      await startAudioCapture();
      
      console.log('[LiveTranscription] Live transcription session started');
    } catch (error) {
      console.error('[LiveTranscription] Failed to start session:', error);
      cleanup();
      throw error;
    }
  };

  const stop = (): void => {
    console.log('[LiveTranscription] Stopping live transcription...');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      // 发送结束消息
      ws.send(JSON.stringify({ end: true, sessionId }));
    }
    
    onStatus?.('ended');
    cleanup();
  };

  return {
    start,
    stop,
    isActive: () => isActive
  };
}

import { ModelConfig } from '../types';
import { chunkPCMData } from '../utils/audio';

const IFYTEK_REALTIME_ENDPOINT = 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1';

interface StreamCallbacks {
  onStatus?: (status: 'connecting' | 'streaming' | 'ended') => void;
  onUpdate?: (payload: { text: string; isFinal: boolean; segmentId?: number; raw: unknown }) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

function formatUtc(now: Date) {
  console.log('[formatUtc] Input date:', now);
  console.log('[formatUtc] Timezone offset (minutes):', now.getTimezoneOffset());
  
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
  
  // Try iFlytek expected format without colon separator: +0800 format
  const result = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}${offsetMins}`;
  console.log('[formatUtc] Formatted result (iFlytek format):', result);
  
  // Also try UTC format
  const utcResult = now.toISOString().replace('.000Z', '+0000');
  console.log('[formatUtc] UTC alternative:', utcResult);
  
  return result; // Keep the original +0800 format as it matches the error URL
}

async function generateSignature(params: Record<string, string>, secret: string): Promise<string> {
  console.log('[generateSignature] Input params:', params);
  console.log('[generateSignature] Secret available:', !!secret);
  
  // Step 1: Sort all parameters (excluding signature) by key name
  const sortedKeys = Object.keys(params).filter(key => key !== 'signature').sort();
  console.log('[generateSignature] Sorted keys:', sortedKeys);
  
  // Step 2: URL encode and create baseString
  const encoder = new TextEncoder();
  const baseString = sortedKeys
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  console.log('[generateSignature] Base string for signature:', baseString);

  // Step 3: HmacSHA1 with accessKeySecret and base64 encode
  const keyData = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(baseString));
  const signatureBytes = new Uint8Array(signatureBuffer);
  let binary = '';
  signatureBytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const signature = btoa(binary);
  console.log('[generateSignature] Generated signature:', signature);
  return signature;
}

function parseResultText(payload: any) {
  console.log('[parseResultText] Input payload:', payload);
  const segments = payload?.cn?.st?.rt ?? [];
  console.log('[parseResultText] Extracted segments:', segments, 'segments count:', segments.length);
  
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    console.log('[parseResultText] Processing segment', i, ':', segment);
    const ws = segment?.ws ?? [];
    
    for (let j = 0; j < ws.length; j++) {
      const word = ws[j];
      console.log('[parseResultText] Processing word', j, 'in segment', i, ':', word);
      const cw = word?.cw ?? [];
      
      for (let k = 0; k < cw.length; k++) {
        const candidate = cw[k];
        console.log('[parseResultText] Processing candidate', k, 'in word', j, ':', candidate);
        if (typeof candidate?.w === 'string') {
          console.log('[parseResultText] Adding candidate text:', candidate.w);
          parts.push(candidate.w);
        }
      }
    }
  }
  
  const result = parts.join('');
  console.log('[parseResultText] Final parsed result:', result, 'parts count:', parts.length);
  return result;
}

export async function streamIflytekRealtime(
  config: ModelConfig,
  pcmBuffer: ArrayBuffer,
  { onStatus, onUpdate, onError, signal }: StreamCallbacks = {},
) {
  console.log('[iFlytekRealtime] Starting streamIflytekRealtime', {
    pcmBufferSize: pcmBuffer.byteLength,
    config: {
      hasAccessKeyId: !!config.accessKeyId,
      hasAppId: !!config.appId,
      hasAccessKeySecret: !!config.accessKeySecret,
      defaultLang: config.defaultLang,
      audioEncode: config.audioEncode,
      sampleRate: config.sampleRate
    },
    callbacks: {
      onStatus: !!onStatus,
      onUpdate: !!onUpdate,
      onError: !!onError
    },
    signalAborted: !!(signal?.aborted)
  });

  const sessionId = crypto.randomUUID();
  console.log('[iFlytekRealtime] Generated session ID:', sessionId);
  
  const now = new Date();
  console.log('[iFlytekRealtime] Current timestamp:', now.toISOString());
  
  // Create parameters according to iFlytek API documentation format
  const params: Record<string, string> = {
    accessKeyId: config.accessKeyId,
    appId: config.appId,
    uuid: sessionId,
    utc: formatUtc(now),
    lang: config.defaultLang ?? 'autodialect',
    audio_encode: config.audioEncode ?? 'pcm_s16le',
  };

  if ((config.audioEncode ?? 'pcm_s16le') === 'pcm_s16le') {
    params.samplerate = String(config.sampleRate ?? 16000);
  }

  console.log('[iFlytekRealtime] Params prepared', {
    paramsKeys: Object.keys(params),
    hasSamplerate: !!params.samplerate,
    utc: params.utc,
    lang: params.lang,
    audioEncode: params.audio_encode
  });

  // Generate signature using the correct method: sort parameters, URL encode, HmacSHA1
  const signature = await generateSignature(params, config.accessKeySecret);
  params.signature = signature;

  console.log('[iFlytekRealtime] Signature generated', {
    signature: params.signature,
    signatureLength: params.signature.length,
    allParamsKeys: Object.keys(params)
  });

  const queryString = new URLSearchParams(params).toString();
  const url = `${IFYTEK_REALTIME_ENDPOINT}?${queryString}`;

  console.log('[iFlytekRealtime] WebSocket URL constructed', {
    endpoint: IFYTEK_REALTIME_ENDPOINT,
    queryParamsCount: Object.keys(params).length,
    queryString: queryString,
    fullUrl: url,
    urlLength: url.length
  });

  console.log('[iFlytekRealtime] Creating WebSocket connection...');
  console.log('[iFlytekRealtime] Full WebSocket URL for debugging:', url);
  
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  console.log('[iFlytekRealtime] WebSocket created, readyState:', ws.readyState);
  console.log('[iFlytekRealtime] WebSocket states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');
  
  // Add timeout to detect if connection hangs
  const connectionTimeout = setTimeout(() => {
    console.error('[iFlytekRealtime] WebSocket connection timeout after 10 seconds');
    if (ws.readyState === WebSocket.CONNECTING) {
      console.error('[iFlytekRealtime] Connection still in CONNECTING state, closing...');
      ws.close();
      onError?.('连接超时');
      rejectPromise(new Error('连接超时'));
    }
  }, 10000);

  const segments = new Map<number, string>();
  let closed = false;
  let resolvePromise: (value: string) => void;
  let rejectPromise: (reason?: unknown) => void;
  const chunks = chunkPCMData(pcmBuffer);
  console.log('[iFlytekRealtime] PCM data chunked into', chunks.length, 'chunks');
  let streamStarted = false;
  let handshakeTimer: number | undefined;

  const resultPromise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const cleanup = () => {
    console.log('[iFlytekRealtime] Cleanup called, closed:', closed);
    if (closed) {
      return;
    }
    closed = true;
    if (handshakeTimer !== undefined) {
      console.log('[iFlytekRealtime] Clearing handshake timer');
      window.clearTimeout(handshakeTimer);
      handshakeTimer = undefined;
    }
    try {
      console.log('[iFlytekRealtime] Closing WebSocket, current readyState:', ws.readyState);
      ws.close();
    } catch (error) {
      console.warn('[iFlytekRealtime] WebSocket close failed', error);
    }
  };

  const abortHandler = () => {
    console.log('[iFlytekRealtime] Abort signal received');
    rejectPromise(new Error('操作已取消'));
    cleanup();
  };

  if (signal) {
    if (signal.aborted) {
      console.log('[iFlytekRealtime] Signal already aborted');
      abortHandler();
      return Promise.reject(new Error('操作已取消'));
    }
    signal.addEventListener('abort', abortHandler, { once: true });
    console.log('[iFlytekRealtime] Abort listener added');
  }

  console.log('[iFlytekRealtime] Setting status to connecting');
  onStatus?.('connecting');

  const beginStreaming = () => {
    console.log('[iFlytekRealtime] beginStreaming called, streamStarted:', streamStarted, 'closed:', closed);
    if (streamStarted || closed) {
      return;
    }
    streamStarted = true;
    if (handshakeTimer !== undefined) {
      console.log('[iFlytekRealtime] Clearing handshake timer in beginStreaming');
      window.clearTimeout(handshakeTimer);
      handshakeTimer = undefined;
    }
    console.log('[iFlytekRealtime] Setting status to streaming');
    onStatus?.('streaming');
    
    (async () => {
      console.log('[iFlytekRealtime] Starting to send', chunks.length, 'audio chunks');
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (closed) {
          console.log('[iFlytekRealtime] Connection closed, stopping chunk sending at', i);
          return;
        }
        console.log('[iFlytekRealtime] Sending chunk', i + 1, '/', chunks.length, 'size:', chunk.byteLength);
        ws.send(chunk);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (!closed) {
        const endMessage = JSON.stringify({ end: true, sessionId });
        console.log('[iFlytekRealtime] Sending end message:', endMessage);
        ws.send(endMessage);
      } else {
        console.log('[iFlytekRealtime] Connection closed, skipping end message');
      }
    })().catch((error) => {
      console.error('[iFlytekRealtime] Failed to stream audio', error);
      onError?.('音频发送失败');
      rejectPromise(error);
      cleanup();
    });
  };

  ws.onopen = () => {
    console.log('[iFlytekRealtime] WebSocket onopen - connection established, readyState:', ws.readyState);
    // 等待服务端返回 started 事件后再发送音频，确保握手流程完成
    console.log('[iFlytekRealtime] Setting handshake timeout (1500ms)');
    handshakeTimer = window.setTimeout(() => {
      console.log('[iFlytekRealtime] Handshake timeout reached, beginning streaming');
      beginStreaming();
    }, 1500);
  };
  
  ws.onmessage = (event) => {
    console.log('[iFlytekRealtime] WebSocket onmessage received, data type:', typeof event.data, 'data:', event.data);
    if (typeof event.data !== 'string') {
      console.log('[iFlytekRealtime] Non-string message received, ignoring');
      return;
    }
    try {
      const data = JSON.parse(event.data);
      console.log('[iFlytekRealtime] Parsed message data:', data);
      
      if (!streamStarted && (data.action === 'started' || data.msg_type === 'started')) {
        console.log('[iFlytekRealtime] Received started event, beginning streaming');
        beginStreaming();
        return;
      }
      
      if (data.action === 'error' || data.msg_type === 'error') {
        const message = data.desc ?? data.data?.desc ?? '服务返回错误';
        console.error('[iFlytekRealtime] Server returned error:', message, 'full data:', data);
        onError?.(message);
        rejectPromise(new Error(message));
        cleanup();
        return;
      }
      
      if (data.res_type === 'frc') {
        const message = data?.data?.desc ?? '实时转写失败';
        console.error('[iFlytekRealtime] FRC error received:', message, 'full data:', data);
        onError?.(message);
        rejectPromise(new Error(message));
        cleanup();
        return;
      }
      
      if (data.msg_type === 'result' && data.res_type === 'asr') {
        console.log('[iFlytekRealtime] ASR result received, data.data:', data.data);
        const text = parseResultText(data.data);
        console.log('[iFlytekRealtime] Parsed text:', text);
        
        const isFinal = Boolean(data.data?.ls);
        const segmentId = data.data?.seg_id;
        console.log('[iFlytekRealtime] Is final result:', isFinal, 'segment:', segmentId);
        
        if (typeof segmentId === 'number') {
          console.log('[iFlytekRealtime] Setting segment', segmentId, 'to:', text);
          segments.set(segmentId, text);
          
          // 重新计算累积文本，确保按segment顺序
          const aggregated = Array.from(segments.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, value]) => value)
            .join('');
          console.log('[iFlytekRealtime] Aggregated text:', aggregated);
          
          onUpdate?.({ text: aggregated, isFinal, segmentId, raw: data });
          
          if (isFinal) {
            console.log('[iFlytekRealtime] Final result received, resolving with:', aggregated);
            resolvePromise(aggregated);
            onStatus?.('ended');
            cleanup();
          }
        } else {
          // 没有segment_id的情况，直接返回当前文本
          onUpdate?.({ text, isFinal, segmentId, raw: data });
          
          if (isFinal) {
            console.log('[iFlytekRealtime] Final result (no segment) received, resolving with:', text);
            resolvePromise(text);
            onStatus?.('ended');
            cleanup();
          }
        }
      } else {
        console.log('[iFlytekRealtime] Unknown message type received:', data);
      }
    } catch (error) {
      console.error('[iFlytekRealtime] Failed to parse websocket message', error, 'raw data:', event.data);
      onError?.('无法解析服务端返回数据');
    }
  };

  ws.onerror = (event) => {
    console.error('[iFlytekRealtime] WebSocket onerror event:', event);
    console.error('[iFlytekRealtime] WebSocket readyState on error:', ws.readyState);
    const message = '实时转写连接异常';
    onError?.(message);
    rejectPromise(new Error(message));
    cleanup();
  };

  ws.onclose = (event) => {
    console.log('[iFlytekRealtime] WebSocket onclose, code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
    console.log('[iFlytekRealtime] WebSocket closed, current closed state:', closed);
    if (!closed) {
      closed = true;
      console.log('[iFlytekRealtime] Setting status to ended due to close');
      onStatus?.('ended');
    }
  };

  return resultPromise.finally(() => {
    cleanup();
    signal?.removeEventListener('abort', abortHandler);
  });
}

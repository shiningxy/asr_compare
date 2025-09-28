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

async function generateSignature(params: Record<string, string>, secret: string) {
  const sortedKeys = Object.keys(params).sort();
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

function parseResultText(payload: any) {
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

export async function streamIflytekRealtime(
  config: ModelConfig,
  pcmBuffer: ArrayBuffer,
  { onStatus, onUpdate, onError, signal }: StreamCallbacks = {},
) {
  const sessionId = crypto.randomUUID();
  const now = new Date();
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

  const signature = await generateSignature(params, config.accessKeySecret);
  params.signature = signature;

  const url = `${IFYTEK_REALTIME_ENDPOINT}?${new URLSearchParams(params).toString()}`;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  const segments = new Map<number, string>();
  let closed = false;
  let resolvePromise: (value: string) => void;
  let rejectPromise: (reason?: unknown) => void;

  const resultPromise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      ws.close();
    } catch (error) {
      console.warn('WebSocket close failed', error);
    }
  };

  const abortHandler = () => {
    rejectPromise(new Error('操作已取消'));
    cleanup();
  };

  if (signal) {
    if (signal.aborted) {
      abortHandler();
      return Promise.reject(new Error('操作已取消'));
    }
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  onStatus?.('connecting');

  ws.onopen = () => {
    onStatus?.('streaming');
    const chunks = chunkPCMData(pcmBuffer);
    (async () => {
      for (const chunk of chunks) {
        if (closed) {
          return;
        }
        ws.send(chunk);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (!closed) {
        ws.send(JSON.stringify({ end: true, sessionId }));
      }
    })().catch((error) => {
      console.error('Failed to stream audio', error);
      onError?.('音频发送失败');
      rejectPromise(error);
      cleanup();
    });
  };

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') {
      return;
    }
    try {
      const data = JSON.parse(event.data);
      if (data.action === 'error' || data.msg_type === 'error') {
        const message = data.desc ?? data.data?.desc ?? '服务返回错误';
        onError?.(message);
        rejectPromise(new Error(message));
        cleanup();
        return;
      }
      if (data.res_type === 'frc') {
        const message = data?.data?.desc ?? '实时转写失败';
        onError?.(message);
        rejectPromise(new Error(message));
        cleanup();
        return;
      }
      if (data.msg_type === 'result' && data.res_type === 'asr') {
        const text = parseResultText(data.data);
        if (typeof data.data?.seg_id === 'number') {
          segments.set(data.data.seg_id, text);
        }
        const aggregated = Array.from(segments.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, value]) => value)
          .join('');
        const isFinal = Boolean(data.data?.ls);
        onUpdate?.({ text: aggregated, isFinal, segmentId: data.data?.seg_id, raw: data });
        if (isFinal) {
          resolvePromise(aggregated);
          onStatus?.('ended');
          cleanup();
        }
      }
    } catch (error) {
      console.error('Failed to parse websocket message', error, event.data);
      onError?.('无法解析服务端返回数据');
    }
  };

  ws.onerror = (event) => {
    console.error('WebSocket error', event);
    const message = '实时转写连接异常';
    onError?.(message);
    rejectPromise(new Error(message));
    cleanup();
  };

  ws.onclose = () => {
    if (!closed) {
      closed = true;
      onStatus?.('ended');
    }
  };

  return resultPromise.finally(() => {
    cleanup();
    signal?.removeEventListener('abort', abortHandler);
  });
}

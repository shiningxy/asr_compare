export type ProviderKey = 'iflytek-realtime';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ProviderKey;
  appId: string;
  accessKeyId: string;
  accessKeySecret: string;
  defaultLang?: string;
  audioEncode?: 'pcm_s16le' | 'speex-7' | 'speex-10' | 'opus-wb';
  sampleRate?: number;
}

export interface ModelRuntimeState {
  id: string;
  status: 'idle' | 'preparing' | 'streaming' | 'error' | 'completed';
  transcript: string;
  interimTranscript?: string;
  error?: string;
  latencyMs?: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface HistoryItem {
  id: string;
  createdAt: number;
  audioName: string;
  durationMs?: number;
  models: Array<{
    modelId: string;
    modelName: string;
    transcript: string;
  }>;
}

export interface RecordingState {
  isRecording: boolean;
  durationMs: number;
  blob?: Blob;
  error?: string;
}

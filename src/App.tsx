import { useEffect, useMemo, useRef, useState } from 'react';
import { HistoryList } from './components/HistoryList';
import { ModelManager } from './components/ModelManager';
import { ResultCard } from './components/ResultCard';
import { ThemeToggle } from './components/ThemeToggle';
import { TranscriptionControls } from './components/TranscriptionControls';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useRecorder } from './hooks/useRecorder';
import { streamIflytekRealtime } from './services/iflytekRealtime';
import { blobToPCM16, fileToPCM16, PCM_BYTES_PER_SECOND } from './utils/audio';
import { HistoryItem, ModelConfig, ModelRuntimeState } from './types';
import './App.css';

const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'iflytek-default',
    name: '讯飞实时大模型',
    provider: 'iflytek-realtime',
    appId: '2c5xxxx',
    accessKeyId: 'e56f66d462cf99e9xxxxxxxxxxxxxx',
    accessKeySecret: 'ZDMyYjZjMjBmYjJlxxxxxxx',
    defaultLang: 'autodialect',
    sampleRate: 16000,
    audioEncode: 'pcm_s16le',
  },
];

function ensureStates(models: ModelConfig[], current: ModelRuntimeState[]) {
  return models.map<ModelRuntimeState>((model) => {
    const existing = current.find((item) => item.id === model.id);
    return (
      existing ?? {
        id: model.id,
        status: 'idle',
        transcript: '',
      }
    );
  });
}

export default function App() {
  const [models, setModels] = useLocalStorage<ModelConfig[]>('asr_compare_models', DEFAULT_MODELS);
  const [history, setHistory] = useLocalStorage<HistoryItem[]>('asr_compare_history', []);
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('asr_compare_theme', 'light');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [runtimeStates, setRuntimeStates] = useState<ModelRuntimeState[]>(() => ensureStates(models, []));
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('准备就绪');
  const abortControllerRef = useRef<AbortController | null>(null);
  const pcmCacheRef = useRef<ArrayBuffer | null>(null);
  const { state: recordingState, start: startRecording, stop: stopRecording, reset: resetRecording } = useRecorder();

  useEffect(() => {
    setRuntimeStates((prev) => ensureStates(models, prev));
  }, [models]);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  const resultsByModel = useMemo(() => {
    return new Map(runtimeStates.map((state) => [state.id, state]));
  }, [runtimeStates]);

  const updateRuntimeState = (modelId: string, updater: (state: ModelRuntimeState) => ModelRuntimeState) => {
    setRuntimeStates((prev) =>
      prev.map((state) => (state.id === modelId ? updater(state) : state)),
    );
  };

  const handleSaveModel = (model: ModelConfig) => {
    setModels((prev) => {
      const next = prev.some((item) => item.id === model.id)
        ? prev.map((item) => (item.id === model.id ? model : item))
        : [...prev, model];
      return next;
    });
  };

  const handleDeleteModel = (id: string) => {
    setModels((prev) => prev.filter((model) => model.id !== id));
    setRuntimeStates((prev) => prev.filter((state) => state.id !== id));
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const preparePcmBuffer = async () => {
    if (selectedFile) {
      setStatusMessage('正在转换音频格式…');
      const buffer = await fileToPCM16(selectedFile, 16000);
      pcmCacheRef.current = buffer;
      return buffer;
    }
    if (recordingState.blob) {
      setStatusMessage('正在处理录音…');
      const buffer = await blobToPCM16(recordingState.blob, 16000);
      pcmCacheRef.current = buffer;
      return buffer;
    }
    throw new Error('请先选择音频或录制语音');
  };

  const handleTranscribe = async () => {
    if (models.length === 0) {
      setStatusMessage('请先配置至少一个模型');
      return;
    }
    if (!selectedFile && !recordingState.blob) {
      setStatusMessage('请先选择音频或录制语音');
      return;
    }
    try {
      setIsProcessing(true);
      setStatusMessage('开始准备音频…');
      setRuntimeStates((prev) =>
        prev.map((state) => ({
          ...state,
          status: 'preparing',
          transcript: '',
          interimTranscript: '',
          error: undefined,
          latencyMs: undefined,
          startedAt: undefined,
          finishedAt: undefined,
        })),
      );

      const pcmBuffer = pcmCacheRef.current ?? (await preparePcmBuffer());
      const audioName = selectedFile?.name ?? '语音录音';
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const startedAt = Date.now();
      const transcriptsMap = new Map<string, string>();
      const tasks = models.map(async (model) => {
        updateRuntimeState(model.id, (state) => ({
          ...state,
          status: 'preparing',
          transcript: '',
          interimTranscript: '',
          error: undefined,
          latencyMs: undefined,
          startedAt,
        }));

        try {
          const finalText = await streamIflytekRealtime(model, pcmBuffer.slice(0), {
            signal: controller.signal,
            onStatus: (status) => {
              if (status === 'streaming') {
                updateRuntimeState(model.id, (state) => ({
                  ...state,
                  status: 'streaming',
                  startedAt: state.startedAt ?? Date.now(),
                }));
              }
              if (status === 'ended') {
                updateRuntimeState(model.id, (state) => ({
                  ...state,
                  status: state.status === 'error' ? state.status : 'completed',
                  finishedAt: Date.now(),
                  latencyMs: state.startedAt ? Date.now() - state.startedAt : undefined,
                }));
              }
            },
            onUpdate: ({ text, isFinal }) => {
              updateRuntimeState(model.id, (state) => ({
                ...state,
                interimTranscript: text,
                transcript: isFinal ? text : state.transcript,
              }));
            },
            onError: (message) => {
              updateRuntimeState(model.id, (state) => ({
                ...state,
                status: 'error',
                error: message,
                finishedAt: Date.now(),
              }));
            },
          });

          updateRuntimeState(model.id, (state) => ({
            ...state,
            status: 'completed',
            transcript: finalText,
            interimTranscript: finalText,
            finishedAt: Date.now(),
            latencyMs: state.startedAt ? Date.now() - state.startedAt : undefined,
          }));

          transcriptsMap.set(model.id, finalText);
          return finalText;
        } catch (error) {
          if (controller.signal.aborted) {
            throw new Error('任务已取消');
          }
          if (error instanceof Error) {
            throw error;
          }
          throw new Error('识别失败');
        }
      });

      await Promise.allSettled(tasks);

      if (controller.signal.aborted) {
        setStatusMessage('已取消当前转写');
      } else if (transcriptsMap.size > 0) {
        const transcripts = models.map((model) => ({
          modelId: model.id,
          modelName: model.name,
          transcript: transcriptsMap.get(model.id) ?? '',
        }));
        const durationMs = Math.round((pcmBuffer.byteLength / PCM_BYTES_PER_SECOND) * 1000);
        const historyItem: HistoryItem = {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          audioName,
          durationMs,
          models: transcripts,
        };
        setHistory((prev) => [...prev.slice(-19), historyItem]);
        setStatusMessage('识别完成');
      } else {
        setStatusMessage('识别失败，请稍后重试');
      }
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : '识别失败');
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
      pcmCacheRef.current = null;
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    setIsProcessing(false);
    setStatusMessage('已取消当前转写');
    setRuntimeStates((prev) =>
      prev.map((state) =>
        state.status === 'streaming' || state.status === 'preparing'
          ? { ...state, status: 'error', error: '任务已取消' }
          : state,
      ),
    );
  };

  const handleClearHistory = () => {
    setHistory([]);
  };

  return (
    <div className="layout">
      <header className="app-header">
        <div>
          <h1>语音转写对比工具</h1>
          <p>并行对比多模型语音识别效果，支持实时录音与历史保存</p>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>

      <main className="content">
        <ModelManager models={models} onSave={handleSaveModel} onDelete={handleDeleteModel} />

        <TranscriptionControls
          selectedFile={selectedFile}
          onFileChange={setSelectedFile}
          recordingState={recordingState}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onResetRecording={resetRecording}
          onTranscribe={handleTranscribe}
          onCancel={handleCancel}
          isProcessing={isProcessing}
          statusMessage={statusMessage}
        />

        <section className="results-grid">
          {models.map((model) => (
            <ResultCard key={model.id} model={model} state={resultsByModel.get(model.id)} />
          ))}
        </section>

        <HistoryList items={history} models={models} onClear={handleClearHistory} />
      </main>

      <footer className="app-footer">© {new Date().getFullYear()} 语音转写实验工具</footer>
    </div>
  );
}

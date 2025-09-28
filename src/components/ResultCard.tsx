import { ModelConfig, ModelRuntimeState } from '../types';
import { formatDuration } from '../utils/time';

const STATUS_LABELS: Record<ModelRuntimeState['status'], string> = {
  idle: '待开始',
  preparing: '准备中',
  streaming: '识别中',
  completed: '已完成',
  error: '失败',
};

interface ResultCardProps {
  model: ModelConfig;
  state?: ModelRuntimeState;
}

export function ResultCard({ model, state }: ResultCardProps) {
  const transcript = state?.transcript || state?.interimTranscript || '尚无结果';
  const latency = state?.latencyMs ? formatDuration(state.latencyMs) : undefined;

  return (
    <article className={`result-card result-card--${state?.status ?? 'idle'}`}>
      <header className="result-card__header">
        <div>
          <h3>{model.name}</h3>
          <p className="result-card__subtitle">科大讯飞 · 实时语音转写（大模型版）</p>
        </div>
        <div className="status">
          <span className={`status-pill status-pill--${state?.status ?? 'idle'}`}>
            {state ? STATUS_LABELS[state.status] : STATUS_LABELS.idle}
          </span>
          {latency && <span className="status__latency">用时 {latency}</span>}
        </div>
      </header>
      {state?.error ? (
        <p className="result-card__error">{state.error}</p>
      ) : (
        <p className="result-card__content">{transcript}</p>
      )}
    </article>
  );
}

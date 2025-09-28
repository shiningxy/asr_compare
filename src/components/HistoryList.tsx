import { HistoryItem, ModelConfig } from '../types';
import { formatDuration, formatTimestamp } from '../utils/time';

interface HistoryListProps {
  items: HistoryItem[];
  models: ModelConfig[];
  onClear: () => void;
}

export function HistoryList({ items, models, onClear }: HistoryListProps) {
  const getModelName = (modelId: string, fallback: string) =>
    models.find((model) => model.id === modelId)?.name ?? fallback;

  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2 className="card__title">识别历史</h2>
          <p className="card__subtitle">记录最近的语音识别结果，可用于快速回溯</p>
        </div>
        <button className="button button--ghost" type="button" disabled={items.length === 0} onClick={onClear}>
          清空历史
        </button>
      </header>
      {items.length === 0 ? (
        <p className="empty">暂无历史记录。</p>
      ) : (
        <ul className="history-list">
          {items
            .slice()
            .reverse()
            .map((item) => (
              <li key={item.id} className="history-item">
                <header>
                  <h3>{item.audioName}</h3>
                  <div className="history-meta">
                    <span>{formatTimestamp(item.createdAt)}</span>
                    {item.durationMs && <span>时长 {formatDuration(item.durationMs)}</span>}
                  </div>
                </header>
                <div className="history-transcripts">
                  {item.models.map((model) => (
                    <article key={model.modelId}>
                      <h4>{getModelName(model.modelId, model.modelName)}</h4>
                      <p>{model.transcript || '（无结果）'}</p>
                    </article>
                  ))}
                </div>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

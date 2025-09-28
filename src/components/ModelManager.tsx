import { useMemo, useState } from 'react';
import { ModelConfig } from '../types';

interface ModelManagerProps {
  models: ModelConfig[];
  onSave: (model: ModelConfig) => void;
  onDelete: (id: string) => void;
}

interface FormState {
  id?: string;
  name: string;
  appId: string;
  accessKeyId: string;
  accessKeySecret: string;
  defaultLang: string;
  sampleRate: number;
}

const LANG_OPTIONS = [
  { label: '自动识别（中英+方言）', value: 'autodialect' },
  { label: '多语种自动识别', value: 'autominor' },
];

/**
 * 对敏感信息进行脱敏处理
 * @param text - 需要脱敏的文本
 * @param keepStart - 保留开头字符数，默认4
 * @param keepEnd - 保留结尾字符数，默认4  
 * @returns 脱敏后的文本
 */
function maskSensitiveText(text: string, keepStart: number = 4, keepEnd: number = 4): string {
  if (!text || text.length <= keepStart + keepEnd) {
    return text;
  }
  
  const start = text.slice(0, keepStart);
  const end = text.slice(-keepEnd);
  const maskLength = Math.min(6, text.length - keepStart - keepEnd); // 最多6个星号
  const mask = '*'.repeat(maskLength);
  
  return `${start}${mask}${end}`;
}

function emptyForm(): FormState {
  return {
    name: '',
    appId: '',
    accessKeyId: '',
    accessKeySecret: '',
    defaultLang: 'autodialect',
    sampleRate: 16000,
  };
}

export function ModelManager({ models, onSave, onDelete }: ModelManagerProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formState, setFormState] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string | undefined>();

  const providerLabel = useMemo(() => '科大讯飞 · 实时语音转写（大模型版）', []);

  const openForCreate = () => {
    setFormState(emptyForm());
    setError(undefined);
    setIsFormOpen(true);
  };

  const openForEdit = (model: ModelConfig) => {
    setFormState({
      id: model.id,
      name: model.name,
      appId: model.appId,
      accessKeyId: model.accessKeyId,
      accessKeySecret: model.accessKeySecret,
      defaultLang: model.defaultLang ?? 'autodialect',
      sampleRate: model.sampleRate ?? 16000,
    });
    setError(undefined);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    if (!formState.name.trim()) {
      setError('请填写模型名称');
      return;
    }
    if (!formState.appId.trim() || !formState.accessKeyId.trim() || !formState.accessKeySecret.trim()) {
      setError('请完整填写鉴权信息');
      return;
    }
    const payload: ModelConfig = {
      id: formState.id ?? crypto.randomUUID(),
      name: formState.name.trim(),
      provider: 'iflytek-realtime',
      appId: formState.appId.trim(),
      accessKeyId: formState.accessKeyId.trim(),
      accessKeySecret: formState.accessKeySecret.trim(),
      defaultLang: formState.defaultLang,
      sampleRate: formState.sampleRate,
      audioEncode: 'pcm_s16le',
    };
    onSave(payload);
    setIsFormOpen(false);
  };

  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2 className="card__title">模型配置</h2>
          <p className="card__subtitle">支持添加多个模型并行对比，目前已接入 {providerLabel}</p>
        </div>
        <button className="button button--primary" onClick={openForCreate} type="button">
          新增模型
        </button>
      </header>

      <div className="model-list">
        {models.length === 0 && <p className="empty">尚未配置模型，请先添加。</p>}
        {models.map((model) => (
          <article key={model.id} className="model-item">
            <div>
              <h3>{model.name}</h3>
              <p className="provider">{providerLabel}</p>
              <dl className="meta-grid">
                <div>
                  <dt>AppID</dt>
                  <dd>{maskSensitiveText(model.appId)}</dd>
                </div>
                <div>
                  <dt>API Key</dt>
                  <dd className="mono">{maskSensitiveText(model.accessKeyId)}</dd>
                </div>
                <div>
                  <dt>API Secret</dt>
                  <dd className="mono">{maskSensitiveText(model.accessKeySecret)}</dd>
                </div>
                <div>
                  <dt>默认语言</dt>
                  <dd>{LANG_OPTIONS.find((option) => option.value === (model.defaultLang ?? 'autodialect'))?.label}</dd>
                </div>
              </dl>
            </div>
            <div className="actions">
              <button className="button button--ghost" type="button" onClick={() => openForEdit(model)}>
                编辑
              </button>
              <button className="button button--danger" type="button" onClick={() => onDelete(model.id)}>
                删除
              </button>
            </div>
          </article>
        ))}
      </div>

      {isFormOpen && (
        <div className="dialog">
          <div className="dialog__content">
            <header className="dialog__header">
              <h3>{formState.id ? '编辑模型' : '新增模型'}</h3>
            </header>
            <form onSubmit={handleSubmit} className="dialog__form">
              <label>
                <span>模型名称</span>
                <input
                  value={formState.name}
                  onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="例如：讯飞实时大模型"
                  required
                />
              </label>
              <label>
                <span>AppID</span>
                <input
                  value={formState.appId}
                  onChange={(event) => setFormState((prev) => ({ ...prev, appId: event.target.value }))}
                  required
                />
              </label>
              <label>
                <span>API Key</span>
                <input
                  value={formState.accessKeyId}
                  onChange={(event) => setFormState((prev) => ({ ...prev, accessKeyId: event.target.value }))}
                  required
                />
              </label>
              <label>
                <span>API Secret</span>
                <input
                  value={formState.accessKeySecret}
                  onChange={(event) => setFormState((prev) => ({ ...prev, accessKeySecret: event.target.value }))}
                  required
                />
              </label>
              <label>
                <span>识别语言</span>
                <select
                  value={formState.defaultLang}
                  onChange={(event) => setFormState((prev) => ({ ...prev, defaultLang: event.target.value }))}
                >
                  {LANG_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>采样率</span>
                <input
                  type="number"
                  value={formState.sampleRate}
                  min={8000}
                  max={48000}
                  step={1000}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, sampleRate: Number(event.target.value) || 16000 }))
                  }
                />
              </label>
              {error && <p className="form-error">{error}</p>}
              <footer className="dialog__footer">
                <button className="button button--ghost" type="button" onClick={closeForm}>
                  取消
                </button>
                <button className="button button--primary" type="submit">
                  保存
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

import { useState, useRef, useEffect } from 'react';
import { ModelConfig } from '../types';
import { createLiveTranscriptionSession, LiveTranscriptionSession } from '../services/iflytekRealtimeLive';

interface LiveTranscriptionPanelProps {
  models: ModelConfig[];
}

interface LiveSessionState {
  status: 'idle' | 'connecting' | 'connected' | 'streaming' | 'ended' | 'error';
  transcript: string;
  error?: string;
  session?: LiveTranscriptionSession;
}

export function LiveTranscriptionPanel({ models }: LiveTranscriptionPanelProps) {
  const [sessions, setSessions] = useState<Map<string, LiveSessionState>>(new Map());
  const [isGlobalActive, setIsGlobalActive] = useState(false);
  const sessionsRef = useRef<Map<string, LiveTranscriptionSession>>(new Map());

  // 初始化所有模型的会话状态
  useEffect(() => {
    const newSessions = new Map<string, LiveSessionState>();
    models.forEach(model => {
      newSessions.set(model.id, {
        status: 'idle',
        transcript: '',
      });
    });
    setSessions(newSessions);
  }, [models]);

  const updateSessionState = (modelId: string, updater: (state: LiveSessionState) => LiveSessionState) => {
    setSessions(prev => {
      const newSessions = new Map(prev);
      const currentState = newSessions.get(modelId);
      if (currentState) {
        newSessions.set(modelId, updater(currentState));
      }
      return newSessions;
    });
  };

  const startLiveTranscription = async () => {
    if (isGlobalActive) return;
    
    if (models.length === 0) {
      alert('请先配置至少一个模型');
      return;
    }

    try {
      setIsGlobalActive(true);
      
      // 为每个模型创建实时转写会话
      for (const model of models) {
        const session = createLiveTranscriptionSession(model, {
          onStatus: (status) => {
            updateSessionState(model.id, state => ({ ...state, status }));
          },
          onUpdate: ({ text, isFinal }) => {
            updateSessionState(model.id, state => ({ 
              ...state, 
              transcript: text
            }));
          },
          onError: (message) => {
            updateSessionState(model.id, state => ({ 
              ...state, 
              status: 'error', 
              error: message 
            }));
          }
        });

        sessionsRef.current.set(model.id, session);
        updateSessionState(model.id, state => ({ ...state, session }));

        try {
          await session.start();
        } catch (error) {
          console.error(`Failed to start session for ${model.name}:`, error);
          updateSessionState(model.id, state => ({ 
            ...state, 
            status: 'error', 
            error: error instanceof Error ? error.message : '启动失败' 
          }));
        }
      }
    } catch (error) {
      console.error('Failed to start live transcription:', error);
      stopLiveTranscription();
    }
  };

  const stopLiveTranscription = () => {
    setIsGlobalActive(false);
    
    // 停止所有会话
    sessionsRef.current.forEach(session => {
      if (session.isActive()) {
        session.stop();
      }
    });
    
    sessionsRef.current.clear();
    
    // 重置所有状态
    setSessions(prev => {
      const newSessions = new Map(prev);
      newSessions.forEach((state, modelId) => {
        newSessions.set(modelId, {
          ...state,
          status: 'idle',
          session: undefined
        });
      });
      return newSessions;
    });
  };

  const clearAllTranscripts = () => {
    setSessions(prev => {
      const newSessions = new Map(prev);
      newSessions.forEach((state, modelId) => {
        newSessions.set(modelId, {
          ...state,
          transcript: '',
          error: undefined
        });
      });
      return newSessions;
    });
  };

  const getStatusText = (status: LiveSessionState['status']): string => {
    switch (status) {
      case 'idle': return '待开始';
      case 'connecting': return '连接中';
      case 'connected': return '已连接';
      case 'streaming': return '识别中';
      case 'ended': return '已结束';
      case 'error': return '错误';
      default: return '未知';
    }
  };

  const getStatusClass = (status: LiveSessionState['status']): string => {
    switch (status) {
      case 'idle': return 'status-idle';
      case 'connecting': return 'status-connecting';
      case 'connected': return 'status-connected';
      case 'streaming': return 'status-streaming';
      case 'ended': return 'status-ended';
      case 'error': return 'status-error';
      default: return 'status-idle';
    }
  };

  return (
    <section className="live-transcription-panel">
      <header className="live-panel-header">
        <h2>🎤 实时语音转写</h2>
        <div className="live-controls">
          <button
            onClick={startLiveTranscription}
            disabled={isGlobalActive}
            className="btn btn-primary"
          >
            {isGlobalActive ? '转写中...' : '开始实时转写'}
          </button>
          <button
            onClick={stopLiveTranscription}
            disabled={!isGlobalActive}
            className="btn btn-secondary"
          >
            停止转写
          </button>
          <button
            onClick={clearAllTranscripts}
            className="btn btn-outline"
          >
            清空结果
          </button>
        </div>
      </header>

      <div className="live-results-grid">
        {models.map(model => {
          const sessionState = sessions.get(model.id);
          if (!sessionState) return null;

          return (
            <div key={model.id} className="live-result-card">
              <header className="live-result-header">
                <div>
                  <h3>{model.name}</h3>
                  <p className="model-subtitle">实时流式转写</p>
                </div>
                <div className={`status-indicator ${getStatusClass(sessionState.status)}`}>
                  <span className="status-dot"></span>
                  <span className="status-text">{getStatusText(sessionState.status)}</span>
                </div>
              </header>
              
              <div className="live-transcript-container">
                {sessionState.error ? (
                  <p className="error-message">❌ {sessionState.error}</p>
                ) : (
                  <div className="live-transcript">
                    {sessionState.transcript || (
                      <span className="placeholder">
                        {sessionState.status === 'streaming' ? '正在监听...' : '暂无转写结果'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {models.length === 0 && (
        <div className="empty-state">
          <p>⚠️ 请先在「模型管理」中配置至少一个模型，然后开始实时转写。</p>
        </div>
      )}
    </section>
  );
}

import { useRef } from 'react';
import { RecordingState } from '../types';
import { formatDuration } from '../utils/time';

interface TranscriptionControlsProps {
  selectedFile: File | null;
  onFileChange: (file: File | null) => void;
  recordingState: RecordingState;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onResetRecording: () => void;
  onCancel: () => void;
  isProcessing: boolean;
  statusMessage?: string;
}

export function TranscriptionControls({
  selectedFile,
  onFileChange,
  recordingState,
  onStartRecording,
  onStopRecording,
  onResetRecording,
  onCancel,
  isProcessing,
  statusMessage,
}: TranscriptionControlsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    onFileChange(file ?? null);
    if (event.target) {
      // 允许连续选择同一文件触发变更
      event.target.value = '';
    }
  };

  const handleSelectFileClick = () => {
    fileInputRef.current?.click();
  };

  const showRecordButton = !recordingState.isRecording;

  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2 className="card__title">音频输入</h2>
          <p className="card__subtitle">支持上传音频文件或直接录音，音频将自动转换为 16k PCM 并立即开始识别</p>
        </div>
      </header>

      <div className="input-grid">
        <div className="input-tile">
          <h3>上传音频文件</h3>
          <p>支持常见音频格式，选择后会自动触发实时转写。</p>
          <div className="file-actions">
            <button className="button button--ghost" type="button" onClick={handleSelectFileClick} disabled={isProcessing}>
              选择文件
            </button>
            <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileInput} hidden />
            {selectedFile && (
              <div className="file-info">
                <span>{selectedFile.name}</span>
                <button className="link" type="button" onClick={() => onFileChange(null)} disabled={isProcessing}>
                  清除
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="input-tile">
          <h3>实时录音</h3>
          <p>点击开始后即可录制语音，停止后系统会自动开始识别。</p>
          <div className="recording-controls">
            {showRecordButton ? (
              <button className="button button--accent" type="button" onClick={onStartRecording} disabled={isProcessing}>
                开始录音
              </button>
            ) : (
              <button className="button button--danger" type="button" onClick={onStopRecording}>
                停止录音
              </button>
            )}
            <div className="recording-status">
              <span className={recordingState.isRecording ? 'dot dot--active' : 'dot'} />
              <span>{formatDuration(recordingState.durationMs)}</span>
              {recordingState.blob && !recordingState.isRecording && (
                <button className="link" type="button" onClick={onResetRecording} disabled={isProcessing}>
                  重新录制
                </button>
              )}
            </div>
            {recordingState.error && <p className="form-error">{recordingState.error}</p>}
          </div>
        </div>
      </div>

      <footer className="controls-footer">
        <div className="status-text">{statusMessage ?? '选取音频或停止录音后将自动开始识别。'}</div>
        <div className="actions">
          <button className="button button--ghost" type="button" onClick={onCancel} disabled={!isProcessing}>
            取消任务
          </button>
        </div>
      </footer>
    </section>
  );
}

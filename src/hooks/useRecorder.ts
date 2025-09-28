import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingState } from '../types';

const TICK_INTERVAL = 200;

export function useRecorder() {
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    durationMs: 0,
  });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = useCallback(async () => {
    if (state.isRecording) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      setState({ isRecording: true, durationMs: 0 });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('Recorder error', event.error);
        setState({
          isRecording: false,
          durationMs: 0,
          error: event.error?.message ?? '录音失败',
        });
        stopTimer();
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.onstop = () => {
        stopTimer();
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setState((prev) => ({
          ...prev,
          isRecording: false,
          blob,
        }));
      };

      mediaRecorder.start(TICK_INTERVAL);
      timerRef.current = window.setInterval(() => {
        setState((prev) => ({
          ...prev,
          durationMs: prev.durationMs + TICK_INTERVAL,
        }));
      }, TICK_INTERVAL);
    } catch (error) {
      console.error('Failed to start recording', error);
      setState({
        isRecording: false,
        durationMs: 0,
        error: error instanceof Error ? error.message : '无法启动录音设备',
      });
    }
  }, [state.isRecording]);

  const stop = useCallback(() => {
    if (!mediaRecorderRef.current) {
      return;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stopTimer();
    mediaRecorderRef.current = null;
    setState({ isRecording: false, durationMs: 0 });
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      stopTimer();
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current?.stop();
    };
  }, []);

  return { state, start, stop, reset };
}

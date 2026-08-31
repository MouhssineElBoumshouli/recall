import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioStudioModule,
  type AudioDataEvent,
  type AudioRecording,
  useAudioRecorder,
} from '@siteed/audio-studio';

import { tokenServerUrl } from '@/config';
import { colors } from '@/design/tokens';
import { createBookmark } from '@/services/bookmarkService';
import { GeminiTokenClient } from '@/services/geminiTokenClient';
import {
  LiveTranscriptionSessionManager,
  type ManagedTranscriptEvent,
} from '@/services/liveTranscriptionSessionManager';
import { TranscriptAccumulator } from '@/services/transcriptAccumulator';
import type { Bookmark } from '@/types/bookmark';
import type {
  RecordingDebugInfo,
  RecordingPhase,
  StoppedRecording,
} from '@/types/recording';
import type { TranscriptSegment } from '@/types/transcript';

const AUDIO_CONFIG = {
  sampleRate: 16_000 as const,
  channels: 1 as const,
  encoding: 'pcm_16bit' as const,
  interval: 100,
  intervalAnalysis: 100,
  enableProcessing: true,
  keepFullAnalysis: false,
  streamFormat: 'raw' as const,
};

type PermissionResult = { granted?: boolean };

type AudioStudioPermissionModule = {
  requestPermissionsAsync?: () => Promise<PermissionResult>;
};

function bytesToBase64(bytes: Uint8Array): string | null {
  const base64Encoder = (globalThis as { btoa?: (value: string) => string }).btoa;
  if (!base64Encoder) {
    return null;
  }

  let binary = '';
  const chunkSize = 0x8_000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return base64Encoder(binary);
}

function audioEventToBase64(event: AudioDataEvent): string | null {
  if (typeof event.data === 'string') {
    return event.data;
  }

  if (event.data instanceof Int16Array) {
    return bytesToBase64(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
  }

  const pcm16 = new Int16Array(event.data.length);
  event.data.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm16[index] = clamped < 0 ? clamped * 0x8_000 : clamped * 0x7_FFF;
  });
  return bytesToBase64(new Uint8Array(pcm16.buffer));
}

function normalizeAmplitude(value: number): number {
  return Math.max(0, Math.min(1, value * 3));
}

const initialDebug: RecordingDebugInfo = {
  connectionState: 'idle',
  sessionGeneration: 0,
  rotationCount: 0,
  reconnectAttempts: 0,
  bufferedAudioChunks: 0,
  droppedAudioChunks: 0,
  socketOpened: false,
  setupComplete: false,
  audioChunksSent: 0,
  serverMessagesReceived: 0,
  interimTranscriptEvents: 0,
  finalTranscriptEvents: 0,
  turnCompleteReceived: false,
  audioStreamEndSent: false,
  lastCloseCode: null,
  lastCloseReason: null,
  lastError: null,
};

export function useRecordingSession() {
  const {
    prepareRecording,
    startRecording: startNativeRecording,
    stopRecording: stopNativeRecording,
  } = useAudioRecorder();
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [connectionState, setConnectionState] = useState('idle');
  const [finalizedSegments, setFinalizedSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [amplitude, setAmplitude] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<RecordingDebugInfo>(initialDebug);
  const [stoppedRecording, setStoppedRecording] = useState<StoppedRecording | null>(null);

  const phaseRef = useRef<RecordingPhase>('idle');
  const startedAtMsRef = useRef(0);
  const nativeStartedRef = useRef(false);
  const bookmarksRef = useRef<Bookmark[]>([]);
  const [transcriptAccumulator] = useState(() => new TranscriptAccumulator());
  const [manager] = useState(
    () =>
      new LiveTranscriptionSessionManager({
        tokenProvider: new GeminiTokenClient(tokenServerUrl),
        onStateChange: (state) => {
          setConnectionState(state);
        },
        onDebugInfo: setDebug,
        onTranscript: (event: ManagedTranscriptEvent) => {
          let snapshot;

          if (event.kind === 'final') {
            transcriptAccumulator.appendFinal({
              kind: 'final',
              text: event.text,
              relativeTimestampMs: event.relativeTimestampMs,
              sessionGeneration: event.sessionGeneration,
              connectionId: event.connectionId,
              sourceId: event.sourceId,
            });
            snapshot = transcriptAccumulator.snapshot();
          } else {
            snapshot = transcriptAccumulator.setInterim({
              kind: 'interim',
              text: event.text,
              relativeTimestampMs: event.relativeTimestampMs,
              sessionGeneration: event.sessionGeneration,
              connectionId: event.connectionId,
            });
          }

          setFinalizedSegments(snapshot.finalizedSegments);
          setInterimText(snapshot.interim?.text || null);
        },
      }),
  );

  useEffect(() => {
    if (phase !== 'recording') {
      return undefined;
    }

    const tick = () => {
      setElapsedMs(Math.max(0, Date.now() - startedAtMsRef.current));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      void (async () => {
        if (nativeStartedRef.current) {
          try {
            await stopNativeRecording();
          } catch {
            // Cleanup must not throw during navigation or a development reload.
          }
          nativeStartedRef.current = false;
        }
        await manager.stop();
      })();
    },
    [manager, stopNativeRecording],
  );

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') {
      return;
    }

    phaseRef.current = 'starting';
    setPhase('starting');
    setError(null);
    setStoppedRecording(null);
    transcriptAccumulator.reset();
    bookmarksRef.current = [];
    setFinalizedSegments([]);
    setInterimText(null);
    setBookmarks([]);
    setAmplitude(0);
    setElapsedMs(0);
    setConnectionState('idle');
    setDebug({ ...initialDebug });

    try {
      const permissionModule = AudioStudioModule as AudioStudioPermissionModule;
      const permission = await permissionModule.requestPermissionsAsync?.();
      if (permission && !permission.granted) {
        throw new Error('Microphone permission was denied. Enable it in system settings to record.');
      }

      const config = {
        ...AUDIO_CONFIG,
        onAudioStream: async (event: AudioDataEvent) => {
          const audioBase64 = audioEventToBase64(event);
          if (audioBase64) {
            manager.sendAudio(audioBase64, Date.now());
          }
        },
        onAudioAnalysis: async (analysis: { dataPoints: { rms: number }[] }) => {
          const point = analysis.dataPoints[analysis.dataPoints.length - 1];
          if (point) {
            setAmplitude(normalizeAmplitude(point.rms));
          }
        },
      };

      await prepareRecording(config);
      const startedAtMs = Date.now();
      await startNativeRecording(config);
      nativeStartedRef.current = true;
      startedAtMsRef.current = startedAtMs;
      phaseRef.current = 'recording';
      setPhase('recording');
      void manager.start(startedAtMs);
    } catch (startError) {
      phaseRef.current = 'idle';
      setPhase('idle');
      setError(startError instanceof Error ? startError.message : 'Unable to start recording.');
      if (nativeStartedRef.current) {
        try {
          await stopNativeRecording();
        } catch {
          // The original start error is more useful to the user than cleanup noise.
        }
        nativeStartedRef.current = false;
      }
      await manager.stop();
    }
  }, [manager, prepareRecording, startNativeRecording, stopNativeRecording, transcriptAccumulator]);

  const stop = useCallback(async () => {
    if (phaseRef.current !== 'recording') {
      return;
    }

    phaseRef.current = 'stopping';
    setPhase('stopping');
    setError(null);
    let recording: AudioRecording | null = null;
    let stopError: string | null = null;

    try {
      if (nativeStartedRef.current) {
        recording = await stopNativeRecording();
        nativeStartedRef.current = false;
      }
    } catch (recordingError) {
      stopError = recordingError instanceof Error ? recordingError.message : 'Audio file finalization failed.';
    } finally {
      await manager.stop();
    }

    const nextDebug = manager.getDebugInfo();
    const nextStoppedRecording: StoppedRecording = {
      recording,
      durationMs: recording?.durationMs || Math.max(0, Date.now() - startedAtMsRef.current),
      finalizedSegments: transcriptAccumulator.snapshot().finalizedSegments,
      bookmarks: bookmarksRef.current,
      debug: nextDebug,
    };
    setStoppedRecording(nextStoppedRecording);
    setElapsedMs(nextStoppedRecording.durationMs);
    setDebug(nextDebug);
    setConnectionState(nextDebug.connectionState);
    setError(stopError);
    phaseRef.current = 'stopped';
    setPhase('stopped');
  }, [manager, stopNativeRecording, transcriptAccumulator]);

  const addBookmark = useCallback(() => {
    if (phaseRef.current !== 'recording') {
      return;
    }

    const bookmark = createBookmark(Date.now() - startedAtMsRef.current);
    const nextBookmarks = [...bookmarksRef.current, bookmark];
    bookmarksRef.current = nextBookmarks;
    setBookmarks(nextBookmarks);
  }, []);

  const reset = useCallback(() => {
    if (phaseRef.current !== 'stopped') {
      return;
    }

    phaseRef.current = 'idle';
    setPhase('idle');
    setStoppedRecording(null);
    setError(null);
    setElapsedMs(0);
    setFinalizedSegments([]);
    setInterimText(null);
    setBookmarks([]);
    setConnectionState('idle');
    setDebug({ ...initialDebug });
  }, []);

  return {
    phase,
    elapsedMs,
    connectionState,
    finalizedSegments,
    interimText,
    bookmarks,
    amplitude,
    error,
    debug,
    stoppedRecording,
    start,
    stop,
    addBookmark,
    reset,
    accentColor: colors.accent,
  };
}

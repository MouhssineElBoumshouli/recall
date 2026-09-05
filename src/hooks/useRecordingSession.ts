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
import { persistRecordingAudio } from '@/services/sessionAudioStorage';
import { createNewSession } from '@/services/sessionFactory';
import { SessionProcessingClient } from '@/services/sessionProcessingClient';
import { joinFinalTranscript, TranscriptAccumulator } from '@/services/transcriptAccumulator';
import { useSessions } from '@/providers/SessionProvider';
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

export interface UseRecordingSessionOptions {
  onSessionCreated?: (sessionId: string) => void;
}

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
  tokenFetched: false,
  setupMessageSent: false,
  setupTimedOut: false,
  socketErrorCount: 0,
  lastServerMessageDataType: null,
  lastCloseCode: null,
  lastCloseReason: null,
  lastError: null,
};

export function useRecordingSession({ onSessionCreated }: UseRecordingSessionOptions = {}) {
  const {
    prepareRecording,
    startRecording: startNativeRecording,
    stopRecording: stopNativeRecording,
  } = useAudioRecorder();
  const { createSession, updateSession, generateIntelligence } = useSessions();
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
  const sessionPersistedRef = useRef(false);
  const bookmarksRef = useRef<Bookmark[]>([]);
  const processingAttemptRef = useRef(0);
  const lastDiagnosticLogRef = useRef('');
  const [transcriptAccumulator] = useState(() => new TranscriptAccumulator());
  const [processingClient] = useState(() => new SessionProcessingClient(tokenServerUrl));
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
    if (!__DEV__) {
      return;
    }

    const signature = [
      debug.connectionState,
      debug.tokenFetched,
      debug.socketOpened,
      debug.setupComplete,
      debug.setupTimedOut,
      debug.serverMessagesReceived,
      debug.interimTranscriptEvents,
      debug.finalTranscriptEvents,
      debug.lastCloseCode,
      debug.lastError,
    ].join('|');
    if (signature === lastDiagnosticLogRef.current) {
      return;
    }

    lastDiagnosticLogRef.current = signature;
    console.debug('[Recall] live diagnostic', {
      state: debug.connectionState,
      tokenFetched: debug.tokenFetched,
      socketOpened: debug.socketOpened,
      setupComplete: debug.setupComplete,
      serverMessagesReceived: debug.serverMessagesReceived,
      interimTranscriptEvents: debug.interimTranscriptEvents,
      finalTranscriptEvents: debug.finalTranscriptEvents,
      lastCloseCode: debug.lastCloseCode,
      lastError: debug.lastError,
    });
  }, [debug]);

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
      if (!sessionPersistedRef.current) {
        processingAttemptRef.current += 1;
      }
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

  const runProcessing = useCallback(
    async (fileUri: string | null, sessionId: string | null, attempt: number, liveTranscript: string) => {
      try {
        if (!fileUri || !sessionId) {
          return;
        }

        const result = await processingClient.process(fileUri);
        if (attempt !== processingAttemptRef.current) {
          return;
        }
        const rawFinalTranscript = result.rawFinalTranscript;
        const repairedTranscript = result.repairedTranscript;
        const hasUsableTranscript = Boolean(rawFinalTranscript?.trim() || repairedTranscript?.trim() || liveTranscript.trim());
        await updateSession(sessionId, {
          liveTranscript,
          rawFinalTranscript,
          repairedTranscript,
          transcriptStatus: hasUsableTranscript ? 'succeeded' : 'failed',
          processingError: result.error,
        });
        void generateIntelligence(sessionId).catch((intelligenceError) => {
          if (__DEV__) {
            console.error('[Recall] intelligence generation could not be persisted:', intelligenceError instanceof Error ? intelligenceError.message : 'unknown error');
          }
        });
      } catch (processingError) {
        if (attempt !== processingAttemptRef.current) {
          return;
        }
        const message = processingError instanceof Error ? processingError.message : 'Transcription processing failed.';
        if (sessionId) {
          await updateSession(sessionId, {
            liveTranscript,
            transcriptStatus: liveTranscript.trim() ? 'succeeded' : 'failed',
            processingError: message,
          }).catch(() => undefined);
          void generateIntelligence(sessionId).catch((intelligenceError) => {
            if (__DEV__) {
              console.error('[Recall] intelligence generation could not be persisted:', intelligenceError instanceof Error ? intelligenceError.message : 'unknown error');
            }
          });
        }
      }
    },
    [generateIntelligence, processingClient, updateSession],
  );

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') {
      return;
    }

    phaseRef.current = 'starting';
    setPhase('starting');
    setError(null);
    setStoppedRecording(null);
    sessionPersistedRef.current = false;
    processingAttemptRef.current += 1;
    transcriptAccumulator.reset();
    bookmarksRef.current = [];
    setFinalizedSegments([]);
    setInterimText(null);
    setBookmarks([]);
    setAmplitude(0);
    setElapsedMs(0);
    setConnectionState('idle');
    setDebug({ ...initialDebug });
    lastDiagnosticLogRef.current = '';

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
    let durableAudioUri: string | null = null;
    let sessionId: string | null = null;

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
    const durationMs = recording?.durationMs || Math.max(0, Date.now() - startedAtMsRef.current);
    const recordedAt = new Date(startedAtMsRef.current).toISOString();
    const nextFinalizedSegments = transcriptAccumulator.snapshot().finalizedSegments;
    const nextBookmarks = bookmarksRef.current;
    const liveTranscript = joinFinalTranscript(nextFinalizedSegments);

    if (!stopError && recording?.fileUri) {
      try {
        sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const durableAudio = await persistRecordingAudio(recording.fileUri, sessionId);
        durableAudioUri = durableAudio.uri;
        const nextSession = createNewSession({
          id: sessionId,
          recordedAt,
          durationMs,
          audioUri: durableAudio.uri,
          finalizedSegments: nextFinalizedSegments,
          bookmarks: nextBookmarks,
        });
        await createSession(nextSession.session, nextSession.bookmarks);
        sessionPersistedRef.current = true;
      } catch (persistenceError) {
        stopError = persistenceError instanceof Error ? persistenceError.message : 'Unable to save the local session.';
        sessionId = null;
      }
    } else if (!stopError) {
      stopError = 'Audio file finalization did not return a local file.';
    }

    const nextStoppedRecording: StoppedRecording = {
      recording,
      recordedAt,
      durationMs,
      finalizedSegments: nextFinalizedSegments,
      bookmarks: nextBookmarks,
      debug: nextDebug,
      sessionId,
      durableAudioUri,
    };
    setStoppedRecording(nextStoppedRecording);
    setElapsedMs(nextStoppedRecording.durationMs);
    setDebug(nextDebug);
    setConnectionState(nextDebug.connectionState);
    setError(stopError);
    const processingAttempt = processingAttemptRef.current + 1;
    processingAttemptRef.current = processingAttempt;
    if (sessionId && durableAudioUri) {
      onSessionCreated?.(sessionId);
      void runProcessing(durableAudioUri, sessionId, processingAttempt, liveTranscript);
    }
    phaseRef.current = 'stopped';
    setPhase('stopped');
  }, [createSession, manager, onSessionCreated, runProcessing, stopNativeRecording, transcriptAccumulator]);

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
    processingAttemptRef.current += 1;
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

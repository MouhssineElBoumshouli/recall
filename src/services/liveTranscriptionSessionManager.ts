import type { RecordingDebugInfo } from '@/types/recording';
import type { TranscriptKind } from '@/types/transcript';

import {
  type ConnectionState,
  transitionConnectionState,
} from './connectionState';
import {
  GeminiLiveTranscription,
  type GeminiLiveConnection,
  type GeminiLiveConnectionCallbacks,
  type LiveTranscriptEvent,
} from './geminiLiveTranscription';
import {
  GEMINI_ROTATION_THRESHOLD_MS,
  getRotationDelayMs,
  sessionRelativeToRecordingTimestamp,
} from './sessionTiming';

interface TokenProvider {
  getToken: () => Promise<{ token: string }>;
}

interface PendingAudioChunk {
  audioBase64: string;
  capturedAtMs: number;
}

interface ManagedConnection {
  id: string;
  generation: number;
  sessionStartedAtOverallMs: number;
  connection: GeminiLiveConnection;
}

export interface ManagedTranscriptEvent {
  kind: TranscriptKind;
  text: string;
  sourceId?: string;
  relativeTimestampMs: number;
  sessionRelativeTimestampMs: number;
  sessionGeneration: number;
  connectionId: string;
}

export interface LiveTranscriptionSessionManagerOptions {
  tokenProvider: TokenProvider;
  createConnection?: (
    token: string,
    callbacks: GeminiLiveConnectionCallbacks,
  ) => GeminiLiveConnection;
  now?: () => number;
  rotationThresholdMs?: number;
  reconnectDelaysMs?: number[];
  maxBufferedChunks?: number;
  onStateChange?: (state: ConnectionState) => void;
  onTranscript?: (event: ManagedTranscriptEvent) => void;
}

const DEFAULT_RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown Gemini Live error';
}

export class LiveTranscriptionSessionManager {
  private readonly tokenProvider: TokenProvider;

  private readonly createConnection: NonNullable<LiveTranscriptionSessionManagerOptions['createConnection']>;

  private readonly now: () => number;

  private readonly rotationThresholdMs: number;

  private readonly reconnectDelaysMs: number[];

  private readonly maxBufferedChunks: number;

  private readonly onStateChange?: (state: ConnectionState) => void;

  private readonly onTranscript?: (event: ManagedTranscriptEvent) => void;

  private state: ConnectionState = 'idle';

  private running = false;

  private recordingStartedAtMs = 0;

  private sessionGeneration = 0;

  private sessionStartedAtOverallMs = 0;

  private activeConnection: ManagedConnection | null = null;

  private connectInFlight = false;

  private reconnectAttempt = 0;

  private rotationCount = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private rotationTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingChunks: PendingAudioChunk[] = [];

  private droppedAudioChunks = 0;

  private lastError: string | null = null;

  public constructor(options: LiveTranscriptionSessionManagerOptions) {
    this.tokenProvider = options.tokenProvider;
    this.createConnection =
      options.createConnection ||
      ((token, callbacks) => new GeminiLiveTranscription(token, callbacks));
    this.now = options.now || Date.now;
    this.rotationThresholdMs = options.rotationThresholdMs || GEMINI_ROTATION_THRESHOLD_MS;
    this.reconnectDelaysMs = options.reconnectDelaysMs || DEFAULT_RECONNECT_DELAYS_MS;
    this.maxBufferedChunks = options.maxBufferedChunks || 50;
    this.onStateChange = options.onStateChange;
    this.onTranscript = options.onTranscript;
  }

  public async start(recordingStartedAtMs: number): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.recordingStartedAtMs = recordingStartedAtMs;
    this.sessionGeneration = 0;
    this.sessionStartedAtOverallMs = 0;
    this.reconnectAttempt = 0;
    this.rotationCount = 0;
    this.droppedAudioChunks = 0;
    this.lastError = null;
    this.pendingChunks = [];
    this.setState(transitionConnectionState(this.state, { type: 'start' }));
    await this.openSession(false);
  }

  public sendAudio(audioBase64: string, capturedAtMs = this.now()): void {
    if (!this.running || !audioBase64) {
      return;
    }

    if (this.activeConnection) {
      try {
        this.activeConnection.connection.sendAudio(audioBase64);
      } catch (error) {
        this.lastError = getErrorMessage(error);
        const lostConnection = this.activeConnection;
        this.activeConnection = null;
        this.setState(transitionConnectionState(this.state, { type: 'connectionLost' }));
        this.scheduleRetry(false);
        try {
          lostConnection.connection.close();
        } catch {
          // The connection is already unusable; keep the audio callback isolated.
        }
      }
      return;
    }

    if (this.pendingChunks.length >= this.maxBufferedChunks) {
      this.pendingChunks.shift();
      this.droppedAudioChunks += 1;
    }

    this.pendingChunks.push({ audioBase64, capturedAtMs });
  }

  public async stop(): Promise<void> {
    if (!this.running && !this.activeConnection) {
      return;
    }

    this.running = false;
    this.setState(transitionConnectionState(this.state, { type: 'stop' }));
    this.clearTimers();
    this.pendingChunks = [];

    const connection = this.activeConnection;
    this.activeConnection = null;
    if (connection) {
      try {
        connection.connection.endAudio();
      } catch (error) {
        this.lastError = getErrorMessage(error);
      }
      await this.wait(350);
      try {
        connection.connection.close();
      } catch (error) {
        this.lastError = getErrorMessage(error);
      }
    }

    this.recordingStartedAtMs = 0;
    this.setState(transitionConnectionState(this.state, { type: 'stopped' }));
  }

  public getDebugInfo(): RecordingDebugInfo {
    return {
      connectionState: this.state,
      sessionGeneration: this.sessionGeneration,
      rotationCount: this.rotationCount,
      reconnectAttempts: this.reconnectAttempt,
      bufferedAudioChunks: this.pendingChunks.length,
      droppedAudioChunks: this.droppedAudioChunks,
      lastError: this.lastError,
    };
  }

  private async openSession(isRotation: boolean): Promise<void> {
    if (!this.running || this.connectInFlight) {
      return;
    }

    this.connectInFlight = true;
    const generation = this.sessionGeneration + 1;
    const connectionId = `gemini-${generation}-${this.now()}`;
    if (isRotation) {
      this.setState(transitionConnectionState(this.state, { type: 'rotationRequested' }));
    } else if (this.activeConnection) {
      this.setState(transitionConnectionState(this.state, { type: 'retry' }));
    } else if (this.state === 'unavailable') {
      this.setState(transitionConnectionState(this.state, { type: 'retry' }));
    }

    try {
      const { token } = await this.tokenProvider.getToken();
      if (!this.running) {
        return;
      }

      const connectionStartedAtOverallMs = this.currentElapsedMs();
      const callbacks: GeminiLiveConnectionCallbacks = {
        onOpen: () => undefined,
        onTranscript: (event) =>
          this.handleTranscript(event, connectionId, generation, connectionStartedAtOverallMs),
        onError: (error) => {
          this.lastError = getErrorMessage(error);
        },
        onClose: (reason) => this.handleClose(connectionId, reason),
      };
      const connection = this.createConnection(token, callbacks);
      await connection.connect();
      if (!this.running) {
        connection.close();
        return;
      }

      const newManagedConnection: ManagedConnection = {
        id: connectionId,
        generation,
        sessionStartedAtOverallMs: connectionStartedAtOverallMs,
        connection,
      };
      const previousConnection = this.activeConnection;
      this.activeConnection = newManagedConnection;
      this.sessionGeneration = generation;
      this.sessionStartedAtOverallMs = connectionStartedAtOverallMs;
      this.reconnectAttempt = 0;
      this.lastError = null;
      if (isRotation) {
        this.rotationCount += 1;
      }
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.setState('connected');
      this.flushPendingChunks();
      this.scheduleRotation();

      if (previousConnection) {
        void this.retireConnection(previousConnection);
      }
    } catch (error) {
      this.lastError = getErrorMessage(error);
      if (this.activeConnection) {
        this.setState('connected');
        this.scheduleRetry(isRotation);
      } else {
        this.setState(transitionConnectionState(this.state, { type: 'failed' }));
        this.scheduleRetry(false);
      }
    } finally {
      this.connectInFlight = false;
    }
  }

  private handleTranscript(
    event: LiveTranscriptEvent,
    connectionId: string,
    generation: number,
    connectionStartedAtOverallMs: number,
  ): void {
    if (!this.recordingStartedAtMs) {
      return;
    }

    const overallElapsedMs = this.currentElapsedMs();
    const sessionRelativeTimestampMs = Math.max(
      0,
      overallElapsedMs - connectionStartedAtOverallMs,
    );
    this.onTranscript?.({
      kind: event.kind,
      text: event.text,
      sourceId: event.sourceId,
      sessionRelativeTimestampMs,
      relativeTimestampMs: sessionRelativeToRecordingTimestamp(
        connectionStartedAtOverallMs,
        sessionRelativeTimestampMs,
      ),
      sessionGeneration: generation,
      connectionId,
    });
  }

  private handleClose(connectionId: string, reason: string): void {
    if (!this.running || this.activeConnection?.id !== connectionId) {
      return;
    }

    this.lastError = reason;
    this.activeConnection = null;
    this.setState(transitionConnectionState(this.state, { type: 'connectionLost' }));
    this.scheduleRetry(false);
  }

  private scheduleRotation(): void {
    if (!this.running) {
      return;
    }

    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
    }

    const delay = getRotationDelayMs(
      this.now(),
      this.recordingStartedAtMs + this.sessionStartedAtOverallMs,
      this.rotationThresholdMs,
    );
    this.rotationTimer = setTimeout(() => {
      this.rotationTimer = null;
      void this.openSession(true);
    }, delay);
  }

  private scheduleRetry(isRotation: boolean): void {
    if (!this.running || this.reconnectTimer) {
      return;
    }

    if (!isRotation) {
      this.setState(transitionConnectionState(this.state, { type: 'retry' }));
    }
    const delay = this.reconnectDelaysMs[
      Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)
    ];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSession(isRotation);
    }, delay);
  }

  private flushPendingChunks(): void {
    const chunks = this.pendingChunks;
    this.pendingChunks = [];
    for (const chunk of chunks) {
      this.sendAudio(chunk.audioBase64, chunk.capturedAtMs);
    }
  }

  private async retireConnection(connection: ManagedConnection): Promise<void> {
    try {
      connection.connection.endAudio();
    } catch (error) {
      this.lastError = getErrorMessage(error);
    }
    await this.wait(250);
    try {
      connection.connection.close();
    } catch (error) {
      this.lastError = getErrorMessage(error);
    }
  }

  private currentElapsedMs(): number {
    return Math.max(0, this.now() - this.recordingStartedAtMs);
  }

  private setState(nextState: ConnectionState): void {
    this.state = nextState;
    this.onStateChange?.(nextState);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  private wait(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}

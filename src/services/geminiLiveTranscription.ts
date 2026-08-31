import type { TranscriptKind } from '@/types/transcript';

export const GEMINI_MODEL = 'gemini-3.5-transcribe-live';
const GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

export interface LiveTranscriptEvent {
  kind: TranscriptKind;
  text: string;
  sourceId?: string;
}

export type GeminiLiveDiagnosticEvent =
  | { type: 'socketOpened' }
  | { type: 'setupComplete' }
  | { type: 'serverMessageReceived' }
  | { type: 'audioChunkSent' }
  | { type: 'interimTranscript' }
  | { type: 'finalTranscript' }
  | { type: 'turnComplete' }
  | { type: 'audioStreamEndSent' }
  | { type: 'socketClosed'; code: number; reason: string };

export interface GeminiLiveConnectionCallbacks {
  onOpen: () => void;
  onTranscript: (event: LiveTranscriptEvent) => void;
  onError: (error: Error) => void;
  onClose: (reason: string) => void;
  onDiagnostic?: (event: GeminiLiveDiagnosticEvent) => void;
}

export interface GeminiLiveConnection {
  connect: () => Promise<void>;
  sendAudio: (audioBase64: string) => void;
  endAudio: () => boolean;
  waitForTurnComplete: (timeoutMs: number) => Promise<boolean>;
  close: () => void;
}

interface GeminiTranscriptPayload {
  text?: string;
  eventId?: string;
}

interface GeminiServerContent {
  inputTranscription?: GeminiTranscriptPayload;
  interimInputTranscription?: GeminiTranscriptPayload;
  turnComplete?: boolean;
  generationComplete?: boolean;
}

interface GeminiServerMessage {
  eventId?: string;
  serverContent?: GeminiServerContent;
  setupComplete?: Record<string, unknown>;
}

function nonEmptyText(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function parseServerMessage(raw: string): GeminiServerMessage | null {
  try {
    return JSON.parse(raw) as GeminiServerMessage;
  } catch {
    return null;
  }
}

function parseTranscriptPayloads(message: GeminiServerMessage): LiveTranscriptEvent[] {
  const content = message.serverContent;
  if (!content) {
    return [];
  }

  const interim = content.interimInputTranscription;
  const final = content.inputTranscription;
  const interimText = nonEmptyText(interim?.text);
  const finalText = nonEmptyText(final?.text);
  const events: LiveTranscriptEvent[] = [];

  if (interimText) {
    events.push({
      kind: 'interim',
      text: interimText,
      sourceId: interim?.eventId || message.eventId,
    });
  }

  if (finalText) {
    events.push({
      kind: 'final',
      text: finalText,
      sourceId: final?.eventId || message.eventId,
    });
  }

  return events;
}

function parseTranscriptMessage(raw: string): LiveTranscriptEvent[] {
  const message = parseServerMessage(raw);
  return message ? parseTranscriptPayloads(message) : [];
}

function isSetupCompleteMessage(message: GeminiServerMessage): boolean {
  return typeof message.setupComplete === 'object' && message.setupComplete !== null;
}

export class GeminiLiveTranscription implements GeminiLiveConnection {
  private socket: WebSocket | null = null;

  private setupComplete = false;

  private turnCompleteSeen = false;

  private turnCompleteSettled = false;

  private turnCompleteResult = false;

  private readonly turnCompleteWaiters = new Set<(complete: boolean) => void>();

  private turnCompleteDrainTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly finalTranscriptDrainMs = 100;

  public constructor(
    private readonly token: string,
    private readonly callbacks: GeminiLiveConnectionCallbacks,
    private readonly connectTimeoutMs = 12_000,
  ) {}

  public connect(): Promise<void> {
    this.setupComplete = false;
    this.turnCompleteSeen = false;
    this.turnCompleteSettled = false;
    this.turnCompleteResult = false;

    return new Promise((resolve, reject) => {
      let settled = false;
      let failureReported = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        const error = new Error('Gemini Live setup timed out');
        failureReported = true;
        settled = true;
        clearTimeout(timeout);
        this.callbacks.onError(error);
        this.socket?.close();
        reject(error);
      }, this.connectTimeoutMs);

      try {
        const url = `${GEMINI_LIVE_URL}?access_token=${encodeURIComponent(this.token)}`;
        const socket = new WebSocket(url);
        this.socket = socket;

        socket.onopen = () => {
          try {
            this.callbacks.onDiagnostic?.({ type: 'socketOpened' });
            socket.send(
              JSON.stringify({
                setup: {
                  model: `models/${GEMINI_MODEL}`,
                  generationConfig: { responseModalities: ['TEXT'] },
                  inputAudioTranscription: { languageCodes: [] },
                },
              }),
            );
          } catch (error) {
            clearTimeout(timeout);
            settled = true;
            failureReported = true;
            const normalized = error instanceof Error ? error : new Error('Gemini setup failed');
            this.callbacks.onError(normalized);
            reject(normalized);
          }
        };

        socket.onmessage = (event) => {
          if (typeof event.data !== 'string') {
            return;
          }

          this.callbacks.onDiagnostic?.({ type: 'serverMessageReceived' });
          const message = parseServerMessage(event.data);
          if (!message) {
            return;
          }

          if (isSetupCompleteMessage(message) && !this.setupComplete) {
            this.setupComplete = true;
            clearTimeout(timeout);
            settled = true;
            this.callbacks.onDiagnostic?.({ type: 'setupComplete' });
            this.callbacks.onOpen();
            resolve();
          }

          const transcripts = parseTranscriptPayloads(message);
          let finalTranscriptReceived = false;
          for (const transcript of transcripts) {
            this.callbacks.onDiagnostic?.({
              type: transcript.kind === 'final' ? 'finalTranscript' : 'interimTranscript',
            });
            this.callbacks.onTranscript(transcript);
            finalTranscriptReceived ||= transcript.kind === 'final';
          }

          if (message.serverContent?.turnComplete === true) {
            this.markTurnComplete();
          } else if (this.turnCompleteSeen && finalTranscriptReceived) {
            // The protocol does not guarantee ordering between turnComplete and
            // the final transcription payload. Give a late final event a short
            // drain window before resolving graceful shutdown.
            this.scheduleTurnCompleteDrain();
          }
        };

        socket.onerror = () => {
          if (failureReported) {
            return;
          }
          const error = new Error(
            this.setupComplete
              ? 'Gemini Live socket error'
              : 'Gemini Live socket error before setup completed',
          );
          failureReported = true;
          this.callbacks.onError(error);
          if (!settled) {
            clearTimeout(timeout);
            settled = true;
            reject(error);
          }
        };

        socket.onclose = (event) => {
          clearTimeout(timeout);
          this.socket = null;
          this.callbacks.onDiagnostic?.({
            type: 'socketClosed',
            code: event.code,
            reason: event.reason || '',
          });
          this.settleTurnComplete(this.turnCompleteSeen);
          if (!settled) {
            settled = true;
            const error = new Error(`Gemini Live closed before setup (${event.reason || event.code})`);
            if (!failureReported) {
              failureReported = true;
              this.callbacks.onError(error);
            }
            reject(error);
          }
          this.callbacks.onClose(event.reason || `code ${event.code}`);
        };
      } catch (error) {
        clearTimeout(timeout);
        settled = true;
        failureReported = true;
        const normalized = error instanceof Error ? error : new Error('Unable to create Gemini Live socket');
        this.callbacks.onError(normalized);
        reject(normalized);
      }
    });
  }

  public sendAudio(audioBase64: string): void {
    if (!this.setupComplete || this.socket?.readyState !== 1) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: audioBase64, mimeType: 'audio/pcm;rate=16000' },
        },
      }),
    );
    this.callbacks.onDiagnostic?.({ type: 'audioChunkSent' });
  }

  public endAudio(): boolean {
    if (!this.setupComplete || this.socket?.readyState !== 1) {
      return false;
    }

    this.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    this.callbacks.onDiagnostic?.({ type: 'audioStreamEndSent' });
    return true;
  }

  public waitForTurnComplete(timeoutMs: number): Promise<boolean> {
    if (this.turnCompleteSettled) {
      return Promise.resolve(this.turnCompleteResult);
    }

    return new Promise((resolve) => {
      let finished = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const finish = (complete: boolean) => {
        if (finished) {
          return;
        }
        finished = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        this.turnCompleteWaiters.delete(finish);
        resolve(complete);
      };
      timeout = setTimeout(() => finish(false), Math.max(0, timeoutMs));
      this.turnCompleteWaiters.add(finish);
    });
  }

  public close(): void {
    if (this.turnCompleteDrainTimer) {
      clearTimeout(this.turnCompleteDrainTimer);
      this.turnCompleteDrainTimer = null;
    }
    this.settleTurnComplete(false);
    this.socket?.close(1000, 'client stop');
    this.socket = null;
  }

  private markTurnComplete(): void {
    this.turnCompleteSeen = true;
    this.callbacks.onDiagnostic?.({ type: 'turnComplete' });
    this.scheduleTurnCompleteDrain();
  }

  private scheduleTurnCompleteDrain(): void {
    if (this.turnCompleteDrainTimer) {
      clearTimeout(this.turnCompleteDrainTimer);
    }
    this.turnCompleteDrainTimer = setTimeout(() => {
      this.turnCompleteDrainTimer = null;
      this.settleTurnComplete(true);
    }, this.finalTranscriptDrainMs);
  }

  private settleTurnComplete(complete: boolean): void {
    if (this.turnCompleteSettled) {
      return;
    }
    this.turnCompleteSettled = true;
    this.turnCompleteResult = complete;
    for (const waiter of this.turnCompleteWaiters) {
      waiter(complete);
    }
    this.turnCompleteWaiters.clear();
  }
}

export const __private__ = { parseTranscriptMessage };

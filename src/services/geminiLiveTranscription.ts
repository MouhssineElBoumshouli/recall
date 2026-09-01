import type { TranscriptKind } from '@/types/transcript';

export const GEMINI_MODEL = 'gemini-3.5-transcribe-live';
const GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

export interface LiveTranscriptEvent {
  kind: TranscriptKind;
  text: string;
  sourceId?: string;
}

export type GeminiLiveMessageDataType = 'text' | 'arrayBuffer' | 'blob' | 'other';

export type GeminiLiveDiagnosticEvent =
  | { type: 'socketOpened' }
  | { type: 'setupComplete' }
  | { type: 'serverMessageReceived'; dataType: GeminiLiveMessageDataType }
  | { type: 'tokenFetched' }
  | { type: 'setupSent' }
  | { type: 'setupTimeout' }
  | { type: 'socketError' }
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

function getMessageDataType(data: unknown): GeminiLiveMessageDataType {
  if (typeof data === 'string') {
    return 'text';
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return 'arrayBuffer';
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return 'blob';
  }
  return 'other';
}

async function decodeMessageData(data: unknown): Promise<string | null> {
  if (typeof data === 'string') {
    return data;
  }

  const decoder = (globalThis as typeof globalThis & { TextDecoder?: typeof TextDecoder }).TextDecoder;
  if (data instanceof ArrayBuffer) {
    return decoder ? new decoder().decode(new Uint8Array(data)) : null;
  }
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return decoder ? new decoder().decode(bytes) : null;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.text();
  }
  return null;
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
        this.callbacks.onDiagnostic?.({ type: 'setupTimeout' });
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
            this.callbacks.onDiagnostic?.({ type: 'setupSent' });
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
          const dataType = getMessageDataType(event.data);
          this.callbacks.onDiagnostic?.({ type: 'serverMessageReceived', dataType });
          void this.handleMessageData(event.data, () => {
            if (settled || this.setupComplete) {
              return;
            }
            this.setupComplete = true;
            clearTimeout(timeout);
            settled = true;
            this.callbacks.onDiagnostic?.({ type: 'setupComplete' });
            this.callbacks.onOpen();
            resolve();
          });
        };

        socket.onerror = () => {
          this.callbacks.onDiagnostic?.({ type: 'socketError' });
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

  private async handleMessageData(data: unknown, onSetupComplete: () => void): Promise<void> {
    let raw: string | null;
    try {
      raw = await decodeMessageData(data);
    } catch {
      raw = null;
    }
    if (!raw) {
      return;
    }

    const message = parseServerMessage(raw);
    if (!message) {
      return;
    }

    if (isSetupCompleteMessage(message) && !this.setupComplete) {
      onSetupComplete();
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

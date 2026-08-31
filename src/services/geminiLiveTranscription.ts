import type { TranscriptKind } from '@/types/transcript';

export const GEMINI_MODEL = 'gemini-3.5-transcribe-live';
const GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

export interface LiveTranscriptEvent {
  kind: TranscriptKind;
  text: string;
  sourceId?: string;
}

export interface GeminiLiveConnectionCallbacks {
  onOpen: () => void;
  onTranscript: (event: LiveTranscriptEvent) => void;
  onError: (error: Error) => void;
  onClose: (reason: string) => void;
}

export interface GeminiLiveConnection {
  connect: () => Promise<void>;
  sendAudio: (audioBase64: string) => void;
  endAudio: () => void;
  close: () => void;
}

interface GeminiTranscriptPayload {
  text?: string;
  eventId?: string;
  event_id?: string;
}

interface GeminiServerContent {
  inputTranscription?: GeminiTranscriptPayload;
  interimInputTranscription?: GeminiTranscriptPayload;
  input_transcription?: GeminiTranscriptPayload;
  interim_input_transcription?: GeminiTranscriptPayload;
}

interface GeminiServerMessage {
  eventId?: string;
  event_id?: string;
  serverContent?: GeminiServerContent;
  server_content?: GeminiServerContent;
}

function nonEmptyText(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function parseTranscriptMessage(raw: string): LiveTranscriptEvent | null {
  let message: GeminiServerMessage;
  try {
    message = JSON.parse(raw) as GeminiServerMessage;
  } catch {
    return null;
  }

  const content = message.serverContent || message.server_content;
  if (!content) {
    return null;
  }

  const interim = content.interimInputTranscription || content.interim_input_transcription;
  const final = content.inputTranscription || content.input_transcription;
  const interimText = nonEmptyText(interim?.text);
  const finalText = nonEmptyText(final?.text);

  if (interimText) {
    return {
      kind: 'interim',
      text: interimText,
      sourceId: interim?.eventId || interim?.event_id || message.eventId || message.event_id,
    };
  }

  if (finalText) {
    return {
      kind: 'final',
      text: finalText,
      sourceId: final?.eventId || final?.event_id || message.eventId || message.event_id,
    };
  }

  return null;
}

export class GeminiLiveTranscription implements GeminiLiveConnection {
  private socket: WebSocket | null = null;

  public constructor(
    private readonly token: string,
    private readonly callbacks: GeminiLiveConnectionCallbacks,
    private readonly connectTimeoutMs = 12_000,
  ) {}

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.socket?.close();
        reject(new Error('Gemini Live connection timed out'));
      }, this.connectTimeoutMs);

      try {
        const url = `${GEMINI_LIVE_URL}?access_token=${encodeURIComponent(this.token)}`;
        const socket = new WebSocket(url);
        this.socket = socket;

        socket.onopen = () => {
          try {
            socket.send(
              JSON.stringify({
                setup: {
                  model: `models/${GEMINI_MODEL}`,
                  generationConfig: { responseModalities: ['TEXT'] },
                  inputAudioTranscription: { languageCodes: [] },
                },
              }),
            );
            clearTimeout(timeout);
            settled = true;
            this.callbacks.onOpen();
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            settled = true;
            const normalized = error instanceof Error ? error : new Error('Gemini setup failed');
            this.callbacks.onError(normalized);
            reject(normalized);
          }
        };

        socket.onmessage = (event) => {
          if (typeof event.data !== 'string') {
            return;
          }
          const transcript = parseTranscriptMessage(event.data);
          if (transcript) {
            this.callbacks.onTranscript(transcript);
          }
        };

        socket.onerror = () => {
          const error = new Error('Gemini Live socket error');
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
          if (!settled) {
            settled = true;
            reject(new Error(`Gemini Live closed before setup (${event.reason || event.code})`));
          }
          this.callbacks.onClose(event.reason || `code ${event.code}`);
        };
      } catch (error) {
        clearTimeout(timeout);
        settled = true;
        reject(error instanceof Error ? error : new Error('Unable to create Gemini Live socket'));
      }
    });
  }

  public sendAudio(audioBase64: string): void {
    if (this.socket?.readyState !== 1) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: audioBase64, mimeType: 'audio/pcm;rate=16000' },
        },
      }),
    );
  }

  public endAudio(): void {
    if (this.socket?.readyState !== 1) {
      return;
    }

    this.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  }

  public close(): void {
    this.socket?.close(1000, 'client stop');
    this.socket = null;
  }
}

export const __private__ = { parseTranscriptMessage };

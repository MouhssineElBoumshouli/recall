import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __private__,
  GeminiLiveTranscription,
  type GeminiLiveConnectionCallbacks,
} from '@/services/geminiLiveTranscription';

class FakeWebSocket {
  public static readonly OPEN = 1;

  public readyState = 0;

  public sent: string[] = [];

  public onopen: ((event: Event) => void) | null = null;

  public onmessage: ((event: MessageEvent) => void) | null = null;

  public onerror: ((event: Event) => void) | null = null;

  public onclose: ((event: CloseEvent) => void) | null = null;

  public constructor(_url: string) {
    sockets.push(this);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  public emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  public emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  public emitClose(code: number, reason: string): void {
    this.close(code, reason);
  }
}

let sockets: FakeWebSocket[] = [];

function createCallbacks() {
  return {
    onOpen: vi.fn<GeminiLiveConnectionCallbacks['onOpen']>(),
    onTranscript: vi.fn<GeminiLiveConnectionCallbacks['onTranscript']>(),
    onError: vi.fn<GeminiLiveConnectionCallbacks['onError']>(),
    onClose: vi.fn<GeminiLiveConnectionCallbacks['onClose']>(),
    onDiagnostic: vi.fn<NonNullable<GeminiLiveConnectionCallbacks['onDiagnostic']>>(),
  } satisfies GeminiLiveConnectionCallbacks;
}

describe('Gemini Live message parsing', () => {
  it('parses interim-only and final-only input transcription messages', () => {
    expect(
      __private__.parseTranscriptMessage(
        JSON.stringify({
          serverContent: {
            interimInputTranscription: { text: 'Bonjour tout' },
          },
          eventId: 'interim-1',
        }),
      ),
    ).toEqual([
      {
        kind: 'interim',
        text: 'Bonjour tout',
        sourceId: 'interim-1',
      },
    ]);

    expect(
      __private__.parseTranscriptMessage(
        JSON.stringify({
          serverContent: {
            inputTranscription: { text: 'Bonjour tout le monde.' },
          },
          eventId: 'final-1',
        }),
      ),
    ).toEqual([
      {
        kind: 'final',
        text: 'Bonjour tout le monde.',
        sourceId: 'final-1',
      },
    ]);
  });

  it('emits both transcript fields when a server message contains both', () => {
    expect(
      __private__.parseTranscriptMessage(
        JSON.stringify({
          serverContent: {
            interimInputTranscription: { text: 'Today we are' },
            inputTranscription: { text: 'Today we are testing Recall.' },
          },
        }),
      ),
    ).toEqual([
      { kind: 'interim', text: 'Today we are', sourceId: undefined },
      { kind: 'final', text: 'Today we are testing Recall.', sourceId: undefined },
    ]);
  });

  it('ignores malformed and non-transcription messages', () => {
    expect(__private__.parseTranscriptMessage('{not-json')).toEqual([]);
    expect(__private__.parseTranscriptMessage(JSON.stringify({ setupComplete: true }))).toEqual([]);
    expect(
      __private__.parseTranscriptMessage(
        JSON.stringify({ serverContent: { inputTranscription: { text: '   ' } } }),
      ),
    ).toEqual([]);
  });
});

describe('Gemini Live connection lifecycle', () => {
  beforeEach(() => {
    sockets = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not resolve on socket open and resolves after setupComplete', async () => {
    const callbacks = createCallbacks();
    const connection = new GeminiLiveTranscription('ephemeral-test-token', callbacks, 1_000);
    let resolved = false;
    const connectPromise = connection.connect().then(() => {
      resolved = true;
    });
    const socket = sockets[0];

    socket.emitOpen();
    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(callbacks.onOpen).not.toHaveBeenCalled();
    expect(socket.sent).toHaveLength(1);
    expect(callbacks.onDiagnostic).toHaveBeenCalledWith({ type: 'setupSent' });
    expect(JSON.parse(socket.sent[0])).toMatchObject({ setup: { model: 'models/gemini-3.5-transcribe-live' } });

    socket.emitMessage(JSON.stringify({ setupComplete: {} }));
    await connectPromise;

    expect(resolved).toBe(true);
    expect(callbacks.onOpen).toHaveBeenCalledOnce();
    expect(callbacks.onDiagnostic).toHaveBeenCalledWith({ type: 'setupComplete' });
    connection.close();
  });

  it('decodes an ArrayBuffer server message before checking the setup response', async () => {
    const callbacks = createCallbacks();
    const connection = new GeminiLiveTranscription('ephemeral-test-token', callbacks, 1_000);
    const connectPromise = connection.connect();
    const socket = sockets[0];

    socket.emitOpen();
    const setupBytes = new TextEncoder().encode(JSON.stringify({ setupComplete: {} }));
    socket.emitMessage(setupBytes.buffer);
    await connectPromise;

    expect(callbacks.onOpen).toHaveBeenCalledOnce();
    expect(callbacks.onDiagnostic).toHaveBeenCalledWith({
      type: 'serverMessageReceived',
      dataType: 'arrayBuffer',
    });
    connection.close();
  });

  it('does not send audio before setupComplete', async () => {
    const callbacks = createCallbacks();
    const connection = new GeminiLiveTranscription('ephemeral-test-token', callbacks, 1_000);
    const connectPromise = connection.connect();
    const socket = sockets[0];

    socket.emitOpen();
    connection.sendAudio('before-setup');
    expect(socket.sent).toHaveLength(1);

    socket.emitMessage(JSON.stringify({ setupComplete: {} }));
    await connectPromise;
    connection.sendAudio('after-setup');

    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[1])).toEqual({
      realtimeInput: {
        audio: { data: 'after-setup', mimeType: 'audio/pcm;rate=16000' },
      },
    });
    connection.close();
  });

  it('surfaces a useful non-secret error when the socket closes before setupComplete', async () => {
    const callbacks = createCallbacks();
    const connection = new GeminiLiveTranscription('ephemeral-test-token', callbacks, 1_000);
    const connectPromise = connection.connect();
    const socket = sockets[0];

    socket.emitOpen();
    socket.emitClose(1008, 'invalid setup');

    await expect(connectPromise).rejects.toThrow('Gemini Live closed before setup (invalid setup)');
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Gemini Live closed before setup (invalid setup)' }),
    );
  });

  it('keeps a late final transcript inside the bounded turn-completion drain', async () => {
    vi.useFakeTimers();
    const callbacks = createCallbacks();
    const connection = new GeminiLiveTranscription('ephemeral-test-token', callbacks, 1_000);
    const connectPromise = connection.connect();
    const socket = sockets[0];
    socket.emitOpen();
    socket.emitMessage(JSON.stringify({ setupComplete: {} }));
    await connectPromise;

    const completion = connection.waitForTurnComplete(500);
    socket.emitMessage(JSON.stringify({ serverContent: { turnComplete: true } }));
    socket.emitMessage(
      JSON.stringify({ serverContent: { inputTranscription: { text: 'late final' } } }),
    );
    await vi.advanceTimersByTimeAsync(100);

    await expect(completion).resolves.toBe(true);
    expect(callbacks.onTranscript).toHaveBeenCalledWith({
      kind: 'final',
      text: 'late final',
      sourceId: undefined,
    });
    connection.close();
  });
});

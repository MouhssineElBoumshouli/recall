import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  GeminiLiveConnection,
  GeminiLiveConnectionCallbacks,
} from '@/services/geminiLiveTranscription';
import { LiveTranscriptionSessionManager } from '@/services/liveTranscriptionSessionManager';

class FakeConnection implements GeminiLiveConnection {
  public audioChunks: string[] = [];

  public ended = false;

  public closed = false;

  private readonly turnWaiters: Array<(complete: boolean) => void> = [];

  public constructor(public readonly callbacks: GeminiLiveConnectionCallbacks) {}

  public async connect(): Promise<void> {
    this.callbacks.onDiagnostic?.({ type: 'socketOpened' });
    this.callbacks.onDiagnostic?.({ type: 'setupComplete' });
    this.callbacks.onOpen();
  }

  public sendAudio(audioBase64: string): void {
    this.audioChunks.push(audioBase64);
    this.callbacks.onDiagnostic?.({ type: 'audioChunkSent' });
  }

  public endAudio(): boolean {
    this.ended = true;
    this.callbacks.onDiagnostic?.({ type: 'audioStreamEndSent' });
    return true;
  }

  public waitForTurnComplete(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (complete: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(complete);
      };
      const timeout = setTimeout(() => finish(false), timeoutMs);
      this.turnWaiters.push(finish);
    });
  }

  public completeTurn(): void {
    this.callbacks.onDiagnostic?.({ type: 'turnComplete' });
    this.turnWaiters.shift()?.(true);
  }

  public close(): void {
    this.closed = true;
    this.callbacks.onDiagnostic?.({ type: 'socketClosed', code: 1000, reason: 'client stop' });
  }
}

describe('LiveTranscriptionSessionManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function createManager(
    connections: FakeConnection[],
    now: () => number,
    options: { rotationThresholdMs?: number; finalizationTimeoutMs?: number } = {},
  ): LiveTranscriptionSessionManager {
    let tokenCount = 0;
    return new LiveTranscriptionSessionManager({
      tokenProvider: {
        getToken: async () => ({ token: `ephemeral-${tokenCount++}` }),
      },
      now,
      rotationThresholdMs: options.rotationThresholdMs ?? 60_000,
      finalizationTimeoutMs: options.finalizationTimeoutMs ?? 100,
      reconnectDelaysMs: [10],
      createConnection: (_token, callbacks) => {
        const connection = new FakeConnection(callbacks);
        connections.push(connection);
        return connection;
      },
    });
  }

  it('rotates a live session while keeping the application recording clock continuous', async () => {
    vi.useFakeTimers();
    let nowMs = 1;
    const connections: FakeConnection[] = [];
    const states: string[] = [];
    const manager = new LiveTranscriptionSessionManager({
      tokenProvider: {
        getToken: async () => ({ token: 'ephemeral-test-token' }),
      },
      now: () => nowMs,
      rotationThresholdMs: 100,
      reconnectDelaysMs: [10],
      finalizationTimeoutMs: 50,
      createConnection: (_token, callbacks) => {
        const connection = new FakeConnection(callbacks);
        connections.push(connection);
        return connection;
      },
      onStateChange: (state) => states.push(state),
    });

    await manager.start(1);
    expect(manager.getDebugInfo().sessionGeneration).toBe(1);
    manager.sendAudio('first-chunk');
    expect(connections[0].audioChunks).toEqual(['first-chunk']);

    nowMs = 101;
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(manager.getDebugInfo().sessionGeneration).toBe(2);
    expect(manager.getDebugInfo().rotationCount).toBe(1);
    expect(states).toContain('rotating');
    expect(states.at(-1)).toBe('connected');
    expect(connections[0].ended).toBe(true);
    connections[0].completeTurn();

    const stopPromise = manager.stop();
    connections[1].completeTurn();
    await stopPromise;
    expect(connections[1].closed).toBe(true);
  });

  it('sends audioStreamEnd and accepts a late final transcript before closing', async () => {
    vi.useFakeTimers();
    let nowMs = 1;
    const connections: FakeConnection[] = [];
    const transcripts: string[] = [];
    const manager = new LiveTranscriptionSessionManager({
      tokenProvider: {
        getToken: async () => ({ token: 'ephemeral-test-token' }),
      },
      now: () => nowMs,
      finalizationTimeoutMs: 100,
      createConnection: (_token, callbacks) => {
        const connection = new FakeConnection(callbacks);
        connections.push(connection);
        return connection;
      },
      onTranscript: (event) => transcripts.push(event.text),
    });

    await manager.start(1);
    const stopPromise = manager.stop();

    expect(connections[0].ended).toBe(true);
    expect(connections[0].closed).toBe(false);
    connections[0].callbacks.onTranscript({ kind: 'final', text: 'late final', sourceId: 'final-1' });
    connections[0].completeTurn();
    await stopPromise;

    expect(transcripts).toEqual(['late final']);
    expect(connections[0].closed).toBe(true);
    expect(manager.getDebugInfo().audioStreamEndSent).toBe(true);
    expect(manager.getDebugInfo().turnCompleteReceived).toBe(true);
  });

  it('closes after the bounded finalization timeout when no completion arrives', async () => {
    vi.useFakeTimers();
    const connections: FakeConnection[] = [];
    const manager = createManager(connections, () => 1, { finalizationTimeoutMs: 50 });

    await manager.start(1);
    const stopPromise = manager.stop();
    expect(connections[0].closed).toBe(false);

    await vi.advanceTimersByTimeAsync(50);
    await stopPromise;

    expect(connections[0].closed).toBe(true);
    expect(manager.getDebugInfo().turnCompleteReceived).toBe(false);
  });
});

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

  public constructor(public readonly callbacks: GeminiLiveConnectionCallbacks) {}

  public async connect(): Promise<void> {
    this.callbacks.onOpen();
  }

  public sendAudio(audioBase64: string): void {
    this.audioChunks.push(audioBase64);
  }

  public endAudio(): void {
    this.ended = true;
  }

  public close(): void {
    this.closed = true;
  }
}

describe('LiveTranscriptionSessionManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rotates a live session while keeping the application recording clock continuous', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    let tokenCount = 0;
    const connections: FakeConnection[] = [];
    const states: string[] = [];
    const manager = new LiveTranscriptionSessionManager({
      tokenProvider: {
        getToken: async () => ({ token: `ephemeral-${tokenCount++}` }),
      },
      now: () => nowMs,
      rotationThresholdMs: 100,
      reconnectDelaysMs: [10],
      createConnection: (_token, callbacks) => {
        const connection = new FakeConnection(callbacks);
        connections.push(connection);
        return connection;
      },
      onStateChange: (state) => states.push(state),
    });

    await manager.start(0);
    expect(manager.getDebugInfo().sessionGeneration).toBe(1);
    manager.sendAudio('first-chunk');
    expect(connections[0].audioChunks).toEqual(['first-chunk']);

    nowMs = 100;
    await vi.advanceTimersByTimeAsync(100);

    expect(manager.getDebugInfo().sessionGeneration).toBe(2);
    expect(manager.getDebugInfo().rotationCount).toBe(1);
    expect(states).toContain('rotating');
    expect(states.at(-1)).toBe('connected');
    expect(connections[0].ended).toBe(true);
    const stopPromise = manager.stop();
    await vi.advanceTimersByTimeAsync(350);
    await stopPromise;
  });
});

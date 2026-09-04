import { describe, expect, it, vi } from 'vitest';

import { SessionProcessingClient } from '@/services/sessionProcessingClient';

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    blob: vi.fn().mockResolvedValue(new Blob(['RIFF audio'])),
    json: vi.fn().mockResolvedValue(payload),
  };
}

describe('SessionProcessingClient', () => {
  it('uploads a saved WAV to the product processing boundary and keeps both layers', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response({
        rawFinalTranscript: 'A transcript',
        repairedTranscript: 'D2 transcript',
        error: null,
      }));
    const client = new SessionProcessingClient('http://127.0.0.1:8787', fetchImpl);

    await expect(client.process('file:///sessions/audio.wav')).resolves.toEqual({
      rawFinalTranscript: 'A transcript',
      repairedTranscript: 'D2 transcript',
      error: null,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8787/process',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
      }),
    );
  });

  it('reports a remote failure without changing local state', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response({ error: 'server failure' }, false, 502));
    const client = new SessionProcessingClient('http://127.0.0.1:8787', fetchImpl);

    await expect(client.process('file:///sessions/audio.wav')).rejects.toMatchObject({ status: 502 });
  });

  it('rejects an empty local recording before making a server request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(new Blob()),
      json: vi.fn(),
    });
    const client = new SessionProcessingClient('http://127.0.0.1:8787', fetchImpl);

    await expect(client.process('file:///sessions/empty.wav')).rejects.toThrow('saved recording is empty');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});


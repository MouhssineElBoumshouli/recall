import { describe, expect, it, vi } from 'vitest';

import { SessionIntelligenceClient } from '@/services/sessionIntelligenceClient';

const intelligence = {
  summary: 'Summary.',
  keyPoints: ['Point.'],
  actionItems: [],
  chapters: [],
};

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  };
}

describe('SessionIntelligenceClient', () => {
  it('sends only the preferred transcript contract to the server', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true, intelligence }));
    const client = new SessionIntelligenceClient('http://127.0.0.1:8787', fetchImpl);

    await expect(client.generate({
      preferredTranscript: 'Preferred transcript.',
      languageContext: null,
    })).resolves.toEqual(intelligence);

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/intelligence',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredTranscript: 'Preferred transcript.', languageContext: null }),
      }),
    );
  });

  it('reports provider and malformed-response failures without server internals', async () => {
    const failedClient = new SessionIntelligenceClient(
      'http://127.0.0.1:8787',
      vi.fn().mockResolvedValue(response({ code: 'secret provider detail' }, false, 502)),
    );
    await expect(failedClient.generate({ preferredTranscript: 'Transcript.', languageContext: null }))
      .rejects.toMatchObject({ status: 502, message: 'Session intelligence generation failed.' });

    const malformedClient = new SessionIntelligenceClient(
      'http://127.0.0.1:8787',
      vi.fn().mockResolvedValue(response({ ok: true, intelligence: { summary: 'missing arrays' } })),
    );
    await expect(malformedClient.generate({ preferredTranscript: 'Transcript.', languageContext: null }))
      .rejects.toThrow('invalid response');
  });
});

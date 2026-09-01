import { describe, expect, it } from 'vitest';

import {
  RefinedTranscriptionClient,
  type RefinedTranscriptionFetch,
  type RefinedTranscriptionFetchResponse,
} from '@/services/refinedTranscriptionClient';

function response(body: unknown, status = 200): RefinedTranscriptionFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => new Blob(['RIFF'], { type: 'audio/wav' }),
    json: async () => body,
  };
}

describe('RefinedTranscriptionClient', () => {
  it('uploads the local WAV and returns the server transcription without client credentials', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: RefinedTranscriptionFetch = async (input, init) => {
      requests.push({ input, init });
      if (requests.length === 1) {
        return response(null);
      }
      return response({ model: 'gemini-3.5-transcribe', text: 'Bonjour.' });
    };
    const client = new RefinedTranscriptionClient('http://127.0.0.1:8787/', fetchImpl);

    await expect(client.transcribe('file:/recording.wav')).resolves.toEqual({
      model: 'gemini-3.5-transcribe',
      text: 'Bonjour.',
    });

    expect(requests[1]?.init?.method).toBe('POST');
    expect(requests[1]?.init?.headers).toEqual({ 'Content-Type': 'audio/wav' });
    expect(JSON.stringify(requests[1]?.init)).not.toContain('GEMINI_API_KEY');
    expect(requests[1]?.input).toBe('http://127.0.0.1:8787/transcribe');
  });

  it('supports the future custom-vocabulary seam without exposing credentials', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: RefinedTranscriptionFetch = async (input, init) => {
      requests.push({ input, init });
      return requests.length === 1
        ? response(null)
        : response({ model: 'gemini-3.5-transcribe', text: 'Recall.' });
    };
    const client = new RefinedTranscriptionClient('http://127.0.0.1:8787', fetchImpl);

    await client.transcribe('file:/recording.wav', { customVocabulary: ['Recall'] });

    expect(requests[1]?.init?.headers).toEqual({
      'Content-Type': 'audio/wav',
      'X-Recall-Custom-Vocabulary': '["Recall"]',
    });
    expect(JSON.stringify(requests[1]?.init)).not.toContain('GEMINI_API_KEY');
  });

  it('keeps a local-file read failure non-destructive', async () => {
    const fetchImpl: RefinedTranscriptionFetch = async () => response(null, 404);
    const client = new RefinedTranscriptionClient('http://127.0.0.1:8787', fetchImpl);

    await expect(client.transcribe('file:/missing.wav')).rejects.toThrow(
      'Unable to read the saved local recording.',
    );
  });

  it('surfaces a non-secret backend failure', async () => {
    const fetchImpl: RefinedTranscriptionFetch = async (_input, init) =>
      init
        ? response({ code: 'GEMINI_TRANSCRIPTION_FAILED', error: 'backend details are not returned to the client' }, 502)
        : response(null);
    const client = new RefinedTranscriptionClient('http://127.0.0.1:8787', fetchImpl);

    await expect(client.transcribe('file:/recording.wav')).rejects.toThrow('Gemini transcription failed.');
  });
});

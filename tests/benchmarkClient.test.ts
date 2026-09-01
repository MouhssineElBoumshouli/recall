import { describe, expect, it } from 'vitest';

import {
  TranscriptionBenchmarkClient,
  type BenchmarkFetch,
  type BenchmarkFetchResponse,
} from '@/services/benchmarkClient';

function response(body: unknown, status = 200): BenchmarkFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => new Blob(['RIFF'], { type: 'audio/wav' }),
    json: async () => body,
  };
}

const benchmarkResponse = {
  reconciliationEnabled: false,
  results: {
    'gemini-transcribe': {
      id: 'gemini-transcribe',
      label: 'GEMINI TRANSCRIBE · A',
      model: 'gemini-3.5-transcribe',
      languageConfiguration: 'automatic detection · language_codes: [] · verbatim',
      status: 'succeeded',
      text: 'A output',
      error: null,
      processingMs: 10,
    },
  },
};

describe('TranscriptionBenchmarkClient', () => {
  it('posts one local WAV to the benchmark boundary without client credentials', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: BenchmarkFetch = async (input, init) => {
      requests.push({ input, init });
      return requests.length === 1 ? response(null) : response(benchmarkResponse);
    };
    const client = new TranscriptionBenchmarkClient('http://127.0.0.1:8787/', fetchImpl);

    await expect(client.run('file:/recording.wav')).resolves.toEqual(benchmarkResponse);

    expect(requests[1]?.input).toBe('http://127.0.0.1:8787/benchmark');
    expect(requests[1]?.init?.method).toBe('POST');
    expect(requests[1]?.init?.headers).toEqual({ 'Content-Type': 'audio/wav' });
    expect(JSON.stringify(requests[1]?.init)).not.toContain('GEMINI_API_KEY');
  });

  it('reports a non-secret benchmark boundary failure', async () => {
    const fetchImpl: BenchmarkFetch = async (_input, init) =>
      init ? response({ error: 'provider details stay server-side' }, 502) : response(null);
    const client = new TranscriptionBenchmarkClient('http://127.0.0.1:8787', fetchImpl);

    await expect(client.run('file:/recording.wav')).rejects.toThrow('The transcription benchmark request failed.');
  });
});

import { tokenServerUrl } from '@/config';
import type {
  BenchmarkBackendResult,
  BenchmarkResponse,
} from '@/types/benchmark';

export interface BenchmarkFetchResponse {
  ok: boolean;
  status: number;
  blob(): Promise<Blob>;
  json(): Promise<unknown>;
}

export type BenchmarkFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<BenchmarkFetchResponse>;

export class BenchmarkClientError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'BenchmarkClientError';
    this.status = status;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function isBenchmarkBackendResult(value: unknown): value is BenchmarkBackendResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const result = value as Record<string, unknown>;
  return (
    typeof result.id === 'string' &&
    typeof result.label === 'string' &&
    typeof result.model === 'string' &&
    typeof result.languageConfiguration === 'string' &&
    (result.status === 'pending' ||
      result.status === 'running' ||
      result.status === 'succeeded' ||
      result.status === 'failed') &&
    (typeof result.text === 'string' || result.text === null) &&
    (typeof result.error === 'string' || result.error === null) &&
    (typeof result.processingMs === 'number' || result.processingMs === null)
  );
}

function parseBenchmarkResponse(value: unknown): BenchmarkResponse | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const response = value as Record<string, unknown>;
  if (!response.results || typeof response.results !== 'object' || typeof response.reconciliationEnabled !== 'boolean') {
    return null;
  }

  const results = response.results as Record<string, unknown>;
  if (!Object.values(results).every(isBenchmarkBackendResult)) {
    return null;
  }

  return {
    results: results as BenchmarkResponse['results'],
    reconciliationEnabled: response.reconciliationEnabled,
  };
}

export class TranscriptionBenchmarkClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: BenchmarkFetch;

  constructor(baseUrl = tokenServerUrl, fetchImpl: BenchmarkFetch = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
  }

  async run(fileUri: string): Promise<BenchmarkResponse> {
    let localResponse: BenchmarkFetchResponse;
    try {
      localResponse = await this.fetchImpl(fileUri);
    } catch {
      throw new BenchmarkClientError('Unable to read the saved local recording.');
    }

    if (!localResponse.ok) {
      throw new BenchmarkClientError('Unable to read the saved local recording.', localResponse.status);
    }

    let audioBlob: Blob;
    try {
      audioBlob = await localResponse.blob();
    } catch {
      throw new BenchmarkClientError('Unable to read the saved local recording.');
    }

    if (audioBlob.size === 0) {
      throw new BenchmarkClientError('The saved recording is empty.');
    }

    let response: BenchmarkFetchResponse;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/benchmark`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: audioBlob,
      });
    } catch {
      throw new BenchmarkClientError('The transcription benchmark server is unavailable.');
    }

    if (!response.ok) {
      throw new BenchmarkClientError('The transcription benchmark request failed.', response.status);
    }

    const payload = parseBenchmarkResponse(await response.json());
    if (!payload) {
      throw new BenchmarkClientError('The transcription benchmark returned an invalid response.');
    }

    return payload;
  }
}

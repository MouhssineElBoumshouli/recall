import { tokenServerUrl } from '@/config';

export interface SessionProcessingResult {
  rawFinalTranscript: string | null;
  repairedTranscript: string | null;
  error: string | null;
}

interface ProcessingResponse {
  ok: boolean;
  status: number;
  blob(): Promise<Blob>;
  json(): Promise<unknown>;
}

export type SessionProcessingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<ProcessingResponse>;

export class SessionProcessingError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'SessionProcessingError';
    this.status = status;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function isResult(value: unknown): value is SessionProcessingResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    (typeof result.rawFinalTranscript === 'string' || result.rawFinalTranscript === null) &&
    (typeof result.repairedTranscript === 'string' || result.repairedTranscript === null) &&
    (typeof result.error === 'string' || result.error === null)
  );
}

export class SessionProcessingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: SessionProcessingFetch;

  constructor(baseUrl = tokenServerUrl, fetchImpl: SessionProcessingFetch = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
  }

  async process(fileUri: string): Promise<SessionProcessingResult> {
    let localResponse: ProcessingResponse;
    try {
      localResponse = await this.fetchImpl(fileUri);
    } catch {
      throw new SessionProcessingError('Unable to read the saved local recording.');
    }
    if (!localResponse.ok) {
      throw new SessionProcessingError('Unable to read the saved local recording.', localResponse.status);
    }

    let audioBlob: Blob;
    try {
      audioBlob = await localResponse.blob();
    } catch {
      throw new SessionProcessingError('Unable to read the saved local recording.');
    }
    if (audioBlob.size === 0) {
      throw new SessionProcessingError('The saved recording is empty.');
    }

    let response: ProcessingResponse;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: audioBlob,
      });
    } catch {
      throw new SessionProcessingError('The session processing server is unavailable.');
    }
    if (!response.ok) {
      throw new SessionProcessingError('Session transcript processing failed.', response.status);
    }

    const payload = await response.json();
    if (!isResult(payload)) {
      throw new SessionProcessingError('Session transcript processing returned an invalid response.');
    }
    return payload;
  }
}


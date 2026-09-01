import { tokenServerUrl } from '@/config';

export interface RefinedTranscriptionOptions {
  customVocabulary?: string[];
}

export interface RefinedTranscriptionResult {
  model: string;
  text: string;
}

export interface RefinedTranscriptionFetchResponse {
  ok: boolean;
  status: number;
  blob(): Promise<Blob>;
  json(): Promise<unknown>;
}

export type RefinedTranscriptionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<RefinedTranscriptionFetchResponse>;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function isRefinedTranscriptionResponse(value: unknown): value is RefinedTranscriptionResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return typeof response.model === 'string' && typeof response.text === 'string';
}

export class RefinedTranscriptionClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: RefinedTranscriptionFetch;

  constructor(baseUrl = tokenServerUrl, fetchImpl: RefinedTranscriptionFetch = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
  }

  async transcribe(
    fileUri: string,
    options: RefinedTranscriptionOptions = {},
  ): Promise<RefinedTranscriptionResult> {
    const localResponse = await this.fetchImpl(fileUri);
    if (!localResponse.ok) {
      throw new Error('Unable to read the saved local recording for refinement.');
    }

    const audioBlob = await localResponse.blob();
    if (audioBlob.size === 0) {
      throw new Error('The saved local recording is empty.');
    }

    const headers: Record<string, string> = { 'Content-Type': 'audio/wav' };
    const customVocabulary = options.customVocabulary ?? [];
    if (customVocabulary.length > 0) {
      headers['X-Recall-Custom-Vocabulary'] = JSON.stringify(customVocabulary);
    }

    const response = await this.fetchImpl(`${this.baseUrl}/transcribe`, {
      method: 'POST',
      headers,
      body: audioBlob,
    });

    if (!response.ok) {
      throw new Error(`Transcript refinement failed (${response.status}).`);
    }

    const payload = await response.json();
    if (!isRefinedTranscriptionResponse(payload)) {
      throw new Error('Transcript refinement returned an invalid response.');
    }

    return payload;
  }
}

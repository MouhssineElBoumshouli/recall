import { tokenServerUrl } from '@/config';

export interface RefinedTranscriptionOptions {
  customVocabulary?: string[];
}

export interface RefinedTranscriptionResult {
  model: string;
  text: string;
}

export type RefinedTranscriptionFailureCode =
  | 'LOCAL_FILE_READ_FAILED'
  | 'MISSING_AUDIO'
  | 'UNSUPPORTED_TRANSPORT_MIME'
  | 'INVALID_WAV'
  | 'AUDIO_TOO_LARGE'
  | 'GEMINI_UPLOAD_FAILED'
  | 'GEMINI_TRANSCRIPTION_FAILED'
  | 'REFINEMENT_FAILED';

export class RefinedTranscriptionError extends Error {
  readonly code: RefinedTranscriptionFailureCode;

  readonly status: number | null;

  constructor(code: RefinedTranscriptionFailureCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'RefinedTranscriptionError';
    this.code = code;
    this.status = status;
  }
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

function isFailureCode(value: unknown): value is RefinedTranscriptionFailureCode {
  return (
    value === 'LOCAL_FILE_READ_FAILED' ||
    value === 'MISSING_AUDIO' ||
    value === 'UNSUPPORTED_TRANSPORT_MIME' ||
    value === 'INVALID_WAV' ||
    value === 'AUDIO_TOO_LARGE' ||
    value === 'GEMINI_UPLOAD_FAILED' ||
    value === 'GEMINI_TRANSCRIPTION_FAILED' ||
    value === 'REFINEMENT_FAILED'
  );
}

function messageForFailureCode(code: RefinedTranscriptionFailureCode): string {
  switch (code) {
    case 'LOCAL_FILE_READ_FAILED':
      return 'Unable to read the saved local recording.';
    case 'MISSING_AUDIO':
      return 'The saved recording is empty.';
    case 'UNSUPPORTED_TRANSPORT_MIME':
      return 'The recording upload type is unsupported.';
    case 'INVALID_WAV':
      return 'The saved recording is not a valid WAV file.';
    case 'AUDIO_TOO_LARGE':
      return 'The saved recording is too large to refine.';
    case 'GEMINI_UPLOAD_FAILED':
      return 'Gemini audio upload failed.';
    case 'GEMINI_TRANSCRIPTION_FAILED':
      return 'Gemini transcription failed.';
    case 'REFINEMENT_FAILED':
      return 'Transcript refinement failed.';
  }
}

async function createServerError(response: RefinedTranscriptionFetchResponse): Promise<RefinedTranscriptionError> {
  let code: RefinedTranscriptionFailureCode = 'REFINEMENT_FAILED';
  try {
    const payload = await response.json();
    const payloadCode = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).code : null;
    if (isFailureCode(payloadCode)) {
      code = payloadCode;
    } else if (response.status === 413) {
      code = 'AUDIO_TOO_LARGE';
    } else if (response.status === 415) {
      code = 'UNSUPPORTED_TRANSPORT_MIME';
    } else if (response.status === 400) {
      code = 'INVALID_WAV';
    }
  } catch {
    if (response.status === 413) {
      code = 'AUDIO_TOO_LARGE';
    } else if (response.status === 415) {
      code = 'UNSUPPORTED_TRANSPORT_MIME';
    } else if (response.status === 400) {
      code = 'INVALID_WAV';
    }
  }

  return new RefinedTranscriptionError(code, messageForFailureCode(code), response.status);
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
      throw new RefinedTranscriptionError(
        'LOCAL_FILE_READ_FAILED',
        messageForFailureCode('LOCAL_FILE_READ_FAILED'),
        localResponse.status,
      );
    }

    const audioBlob = await localResponse.blob();
    if (audioBlob.size === 0) {
      throw new RefinedTranscriptionError('MISSING_AUDIO', messageForFailureCode('MISSING_AUDIO'));
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
      throw await createServerError(response);
    }

    const payload = await response.json();
    if (!isRefinedTranscriptionResponse(payload)) {
      throw new RefinedTranscriptionError('REFINEMENT_FAILED', 'Transcript refinement returned an invalid response.');
    }

    return payload;
  }
}

import { tokenServerUrl } from '@/config';
import type {
  SessionIntelligenceContent,
  SessionIntelligenceGenerationInput,
} from '@/types/intelligence';

interface IntelligenceResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type SessionIntelligenceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<IntelligenceResponse>;

export class SessionIntelligenceClientError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'SessionIntelligenceClientError';
    this.status = status;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isContent(value: unknown): value is SessionIntelligenceContent {
  if (!isRecord(value) || typeof value.summary !== 'string' || !Array.isArray(value.keyPoints) || !Array.isArray(value.actionItems) || !Array.isArray(value.chapters)) {
    return false;
  }

  return value.keyPoints.every((item) => typeof item === 'string') &&
    value.actionItems.every((item) => isRecord(item) && typeof item.text === 'string' && isNullableString(item.owner) && isNullableString(item.dueDate)) &&
    value.chapters.every((item) => isRecord(item) && typeof item.title === 'string' && typeof item.summary === 'string' && (item.startTimestampMs === null || (typeof item.startTimestampMs === 'number' && Number.isInteger(item.startTimestampMs) && item.startTimestampMs >= 0)));
}

export class SessionIntelligenceClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: SessionIntelligenceFetch;

  constructor(baseUrl = tokenServerUrl, fetchImpl: SessionIntelligenceFetch = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
  }

  async generate(input: SessionIntelligenceGenerationInput): Promise<SessionIntelligenceContent> {
    let response: IntelligenceResponse;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/intelligence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    } catch {
      throw new SessionIntelligenceClientError('The session intelligence server is unavailable.');
    }

    if (!response.ok) {
      throw new SessionIntelligenceClientError('Session intelligence generation failed.', response.status);
    }

    const payload = await response.json();
    const result = isRecord(payload) ? payload.intelligence : null;
    if (!isContent(result)) {
      throw new SessionIntelligenceClientError('Session intelligence returned an invalid response.');
    }
    return result;
  }
}

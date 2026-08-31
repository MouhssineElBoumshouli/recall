export interface EphemeralTokenResponse {
  token: string;
  expiresAt?: string;
}

export class GeminiTokenClient {
  private readonly baseUrl: string;

  public constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public async getToken(signal?: AbortSignal): Promise<EphemeralTokenResponse> {
    const response = await fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Token server request failed (${response.status})`);
    }

    const payload = (await response.json()) as Partial<EphemeralTokenResponse>;
    if (!payload.token) {
      throw new Error('Token server returned no ephemeral token');
    }

    return { token: payload.token, expiresAt: payload.expiresAt };
  }
}

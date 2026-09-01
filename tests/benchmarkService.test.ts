import { describe, expect, it, vi } from 'vitest';

import { runBenchmark } from '../server/benchmarkService';
import { GeminiInteractionError } from '../server/transcriptionService';
import type { GeminiTranscriptionGateway } from '../server/transcriptionService';
import type { Chirp3TranscriptionGateway } from '../server/chirp3TranscriptionService';

function gateways(overrides: Partial<GeminiTranscriptionGateway> = {}): {
  gemini: GeminiTranscriptionGateway;
  chirp: Chirp3TranscriptionGateway;
} {
  return {
    gemini: {
      upload: vi.fn().mockResolvedValue({ name: 'files/benchmark', uri: 'https://files.example/benchmark', mimeType: 'audio/wav' }),
      transcribe: vi.fn().mockResolvedValue('Gemini A transcript'),
      understand: vi.fn().mockResolvedValue('Gemini C transcript'),
      delete: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
    chirp: {
      transcribe: vi.fn().mockResolvedValue('Chirp B transcript'),
    },
  };
}

describe('transcription benchmark orchestration', () => {
  it('returns independent A, B, and C results while sharing one Gemini upload', async () => {
    const { gemini, chirp } = gateways();

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.reconciliationEnabled).toBe(false);
    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'succeeded', text: 'Gemini A transcript' });
    expect(response.results['chirp-3-ar-MA']).toMatchObject({ status: 'succeeded', text: 'Chirp B transcript' });
    expect(response.results['gemini-audio-understanding']).toMatchObject({ status: 'succeeded', text: 'Gemini C transcript' });
    expect(gemini.upload).toHaveBeenCalledTimes(1);
    expect(gemini.delete).toHaveBeenCalledWith('files/benchmark');
  });

  it('does not let Gemini Transcribe failure block Chirp 3', async () => {
    const { gemini, chirp } = gateways({
      transcribe: vi.fn().mockRejectedValue(new Error('A failed')),
    });

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'failed' });
    expect(response.results['chirp-3-ar-MA']).toMatchObject({ status: 'succeeded', text: 'Chirp B transcript' });
  });

  it('does not let Chirp 3 failure block the Gemini paths', async () => {
    const { gemini } = gateways();
    const chirp: Chirp3TranscriptionGateway = {
      transcribe: vi.fn().mockRejectedValue(new Error('B failed')),
    };

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results['chirp-3-ar-MA']).toMatchObject({ status: 'failed' });
    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'succeeded' });
    expect(response.results['gemini-audio-understanding']).toMatchObject({ status: 'succeeded' });
  });

  it('does not let audio understanding failure block Gemini Transcribe or Chirp 3', async () => {
    const { gemini, chirp } = gateways({
      understand: vi.fn().mockRejectedValue(new Error('C failed')),
    });

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results['gemini-audio-understanding']).toMatchObject({ status: 'failed' });
    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'succeeded' });
    expect(response.results['chirp-3-ar-MA']).toMatchObject({ status: 'succeeded' });
  });

  it('returns a safe C diagnostic while preserving A and B results', async () => {
    const { gemini, chirp } = gateways({
      understand: vi.fn().mockRejectedValue(new GeminiInteractionError({
        model: 'gemini-3.7-flash',
        stage: 'during interactions.create',
        code: 'too_many_requests',
        status: 429,
        message: 'quota details stay server-side',
      })),
    });

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results['gemini-audio-understanding']).toMatchObject({
      status: 'failed',
      diagnostic: { stage: 'during interactions.create', code: 'too_many_requests', status: 429 },
    });
    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'succeeded' });
    expect(response.results['chirp-3-ar-MA']).toMatchObject({ status: 'succeeded' });
  });

  it('does not run reconciliation unless explicitly enabled', async () => {
    const { gemini, chirp } = gateways();

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results.reconciled).toBeUndefined();
    expect(gemini.understand).toHaveBeenCalledTimes(1);
  });

  it('runs reconciliation only after A, B, and C succeed and reuses the Gemini File', async () => {
    const { gemini, chirp } = gateways();

    const response = await runBenchmark(gemini, chirp, 'temporary.wav', { includeReconciled: true });

    expect(response.results.reconciled).toMatchObject({ status: 'succeeded' });
    expect(gemini.understand).toHaveBeenCalledTimes(2);
    expect(gemini.delete).toHaveBeenCalledTimes(1);
  });

  it('keeps Chirp independent when the shared Gemini upload fails', async () => {
    const { gemini, chirp } = gateways({
      upload: vi.fn().mockRejectedValue(new Error('upload failed')),
    });

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'failed' });
    expect(response.results['gemini-audio-understanding']).toMatchObject({ status: 'failed' });
    expect(response.results['chirp-3-ar-MA']).toMatchObject({ status: 'succeeded' });
    expect(gemini.delete).not.toHaveBeenCalled();
  });
});

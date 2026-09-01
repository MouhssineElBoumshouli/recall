import { describe, expect, it, vi } from 'vitest';

import { runBenchmark } from '../server/benchmarkService';
import { buildTranscriptRepairInstruction, GeminiInteractionError } from '../server/transcriptionService';
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
      repair: vi.fn().mockResolvedValue('Repaired transcript'),
      delete: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
    chirp: {
      transcribe: vi.fn().mockResolvedValue('Chirp B transcript'),
    },
  };
}

describe('transcription benchmark orchestration', () => {
  it('returns independent A, B, C, and D2 results while sharing one Gemini upload', async () => {
    const { gemini, chirp } = gateways();

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.reconciliationEnabled).toBe(false);
    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'succeeded', text: 'Gemini A transcript' });
    expect(response.results['chirp-3-ar-MA']).toMatchObject({ status: 'succeeded', text: 'Chirp B transcript' });
    expect(response.results['gemini-audio-understanding']).toMatchObject({ status: 'succeeded', text: 'Gemini C transcript' });
    expect(response.results['gemini-flash-lite']).toMatchObject({
      id: 'gemini-flash-lite',
      label: 'GEMINI FLASH-LITE · C2',
      model: 'gemini-3.5-flash-lite',
      status: 'succeeded',
      text: 'Gemini C transcript',
    });
    expect(response.results['transcript-repair']).toMatchObject({
      id: 'transcript-repair',
      label: 'AUDIO-GROUNDED REPAIR · D2',
      model: 'gemini-3.5-flash-lite',
      languageConfiguration: 'AUTO LANGUAGE CONTEXT',
      status: 'succeeded',
      text: 'Repaired transcript',
    });
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

  it('keeps C2 successful when C is rate-limited', async () => {
    const understand: GeminiTranscriptionGateway['understand'] = vi.fn()
      .mockImplementation((_uri, _mimeType, _instruction, model) => (
        model === 'gemini-3.7-flash'
          ? Promise.reject(new Error('C is unavailable'))
          : Promise.resolve('Gemini C2 transcript')
      ));
    const { gemini, chirp } = gateways({ understand });

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results['gemini-audio-understanding']).toMatchObject({ status: 'failed' });
    expect(response.results['gemini-flash-lite']).toMatchObject({ status: 'succeeded', text: 'Gemini C2 transcript' });
    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'succeeded' });
  });

  it('keeps C successful when C2 fails', async () => {
    const understand: GeminiTranscriptionGateway['understand'] = vi.fn()
      .mockImplementation((_uri, _mimeType, _instruction, model) => (
        model === 'gemini-3.5-flash-lite'
          ? Promise.reject(new Error('C2 is unavailable'))
          : Promise.resolve('Gemini C transcript')
      ));
    const { gemini, chirp } = gateways({ understand });

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results['gemini-audio-understanding']).toMatchObject({ status: 'succeeded', text: 'Gemini C transcript' });
    expect(response.results['gemini-flash-lite']).toMatchObject({ status: 'failed' });
    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'succeeded' });
  });

  it('keeps A successful when both audio-understanding backends fail', async () => {
    const { gemini, chirp } = gateways({
      understand: vi.fn().mockRejectedValue(new Error('audio understanding unavailable')),
    });

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'succeeded', text: 'Gemini A transcript' });
    expect(response.results['gemini-audio-understanding']).toMatchObject({ status: 'failed' });
    expect(response.results['gemini-flash-lite']).toMatchObject({ status: 'failed' });
  });

  it('uses only successful A and the original audio as D2 inputs, never C2', async () => {
    const repair = vi.fn().mockResolvedValue('Repaired from A');
    const { gemini } = gateways({ repair });

    await runBenchmark(gemini, null, 'temporary.wav', {
      transcriptLanguageContext: {
        likelyLanguages: ['Spanish', 'English'],
        localeHints: ['United States'],
      },
    });

    expect(repair).toHaveBeenCalledWith(
      'https://files.example/benchmark',
      'audio/wav',
      'Gemini A transcript',
      {
        likelyLanguages: ['Spanish', 'English'],
        localeHints: ['United States'],
      },
    );
    expect(repair.mock.calls[0]?.[2]).not.toBe('Gemini C transcript');
  });

  it('runs D2 with advisory optional language context', async () => {
    const { gemini } = gateways();

    const response = await runBenchmark(gemini, null, 'temporary.wav', {
      transcriptLanguageContext: {
        likelyLanguages: ['Moroccan Darija', 'French', 'English'],
        localeHints: ['Morocco'],
        preserveCodeSwitching: true,
      },
    });

    expect(response.results['transcript-repair']).toMatchObject({
      status: 'succeeded',
      languageConfiguration: 'HINTED: Moroccan Darija · French · English · locale: Morocco',
    });
  });

  it('does not run D2 when A fails', async () => {
    const repair = vi.fn().mockResolvedValue('Should not run');
    const { gemini } = gateways({
      transcribe: vi.fn().mockRejectedValue(new Error('A unavailable')),
      repair,
    });

    const response = await runBenchmark(gemini, null, 'temporary.wav');

    expect(response.results['gemini-transcribe']).toMatchObject({ status: 'failed' });
    expect(response.results['transcript-repair']).toMatchObject({
      status: 'failed',
      error: 'D2 requires a successful Gemini Transcribe result from A.',
    });
    expect(repair).not.toHaveBeenCalled();
  });

  it('keeps A successful when D2 fails', async () => {
    const { gemini } = gateways({
      repair: vi.fn().mockRejectedValue(new Error('D2 unavailable')),
    });

    const response = await runBenchmark(gemini, null, 'temporary.wav');

    expect(response.results['gemini-transcribe']).toMatchObject({
      status: 'succeeded',
      text: 'Gemini A transcript',
    });
    expect(response.results['transcript-repair']).toMatchObject({ status: 'failed' });
  });

  it('preserves a known-good baseline in the repair control seam', async () => {
    const knownGood = 'Hello. This is a clear English sentence.';
    const { gemini } = gateways({
      repair: vi.fn().mockImplementation((_uri, _mime, baseline) => Promise.resolve(baseline)),
      transcribe: vi.fn().mockResolvedValue(knownGood),
    });

    const response = await runBenchmark(gemini, null, 'temporary.wav');

    expect(response.results['transcript-repair']?.text).toBe(knownGood);
  });

  it('supports a deliberately corrupted-baseline repair control without rewriting unrelated text', async () => {
    const corrupted = 'Hello world this is a test. Unrelated phrase stays.';
    const corrected = 'Hello world, this is a test. Unrelated phrase stays.';
    const { gemini } = gateways({
      transcribe: vi.fn().mockResolvedValue(corrupted),
      repair: vi.fn().mockImplementation((_uri, _mime, baseline) => Promise.resolve(
        baseline === corrupted ? corrected : baseline,
      )),
    });

    const response = await runBenchmark(gemini, null, 'temporary.wav');

    expect(response.results['transcript-repair']?.text).toBe(corrected);
  });

  it('keeps the generic repair instruction language-agnostic when context is unknown', () => {
    const instruction = buildTranscriptRepairInstruction('A baseline transcript.');

    expect(instruction).toContain('The original audio is authoritative.');
    expect(instruction).toContain('Preserve natural code-switching.');
    expect(instruction).toContain('Do not translate between languages.');
    expect(instruction).toContain('Do not summarize.');
    expect(instruction).toContain('Do not paraphrase.');
    expect(instruction).not.toMatch(/Moroccan|Darija|Arabic|French|Morocco/i);
  });

  it('makes optional language context advisory rather than authoritative', () => {
    const instruction = buildTranscriptRepairInstruction('Baseline.', {
      likelyLanguages: ['Hindi', 'English'],
      localeHints: ['India'],
      preserveCodeSwitching: true,
    });

    expect(instruction).toContain('Likely languages in this session: Hindi, English.');
    expect(instruction).toContain('Locale hints: India.');
    expect(instruction).toContain('These are hints only. The audio remains authoritative.');
  });

  it('does not run reconciliation unless explicitly enabled', async () => {
    const { gemini, chirp } = gateways();

    const response = await runBenchmark(gemini, chirp, 'temporary.wav');

    expect(response.results.reconciled).toBeUndefined();
    expect(gemini.understand).toHaveBeenCalledTimes(2);
  });

  it('runs reconciliation only after A, B, and C succeed and reuses the Gemini File', async () => {
    const { gemini, chirp } = gateways();

    const response = await runBenchmark(gemini, chirp, 'temporary.wav', { includeReconciled: true });

    expect(response.results.reconciled).toMatchObject({ status: 'succeeded' });
    expect(gemini.understand).toHaveBeenCalledTimes(3);
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

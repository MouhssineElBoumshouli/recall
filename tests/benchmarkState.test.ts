import { describe, expect, it } from 'vitest';

import {
  benchmarkCompleted,
  benchmarkFailed,
  benchmarkStarted,
} from '@/services/benchmarkState';
import { BENCHMARK_BACKEND_DEFINITIONS } from '@/types/benchmark';

describe('benchmark state', () => {
  it('starts A, B, and C independently in a running state', () => {
    const state = benchmarkStarted();

    expect(state.status).toBe('running');
    expect(state.results['gemini-transcribe']?.status).toBe('running');
    expect(state.results['chirp-3-ar-MA']?.status).toBe('running');
    expect(state.results['gemini-audio-understanding']?.status).toBe('running');
    expect(state.results.reconciled).toBeUndefined();
  });

  it('preserves a successful backend when another backend fails', () => {
    const started = benchmarkStarted();
    const completed = benchmarkCompleted({
      reconciliationEnabled: false,
      results: {
        'gemini-transcribe': {
          ...BENCHMARK_BACKEND_DEFINITIONS[0],
          status: 'succeeded',
          text: 'A output',
          error: null,
          processingMs: 10,
        },
        'chirp-3-ar-MA': {
          ...BENCHMARK_BACKEND_DEFINITIONS[1],
          status: 'failed',
          text: null,
          error: 'Chirp unavailable.',
          processingMs: 12,
        },
      },
    });

    expect(started.results['gemini-transcribe']?.status).toBe('running');
    expect(completed.status).toBe('succeeded');
    expect(completed.results['gemini-transcribe']).toMatchObject({ status: 'succeeded', text: 'A output' });
    expect(completed.results['chirp-3-ar-MA']).toMatchObject({ status: 'failed', error: 'Chirp unavailable.' });
  });

  it('marks all pending backend results failed when the benchmark request itself fails', () => {
    const failed = benchmarkFailed(benchmarkStarted(), 'Benchmark server unavailable.');

    expect(failed.status).toBe('failed');
    expect(Object.values(failed.results).every((result) => result?.status === 'failed')).toBe(true);
    expect(failed.error).toBe('Benchmark server unavailable.');
  });
});

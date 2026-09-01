import {
  BENCHMARK_BACKEND_DEFINITIONS,
  type BenchmarkBackendId,
  type BenchmarkBackendResult,
  type BenchmarkResponse,
  type BenchmarkState,
} from '@/types/benchmark';

function createResult(
  id: BenchmarkBackendId,
  status: BenchmarkBackendResult['status'],
  error: string | null = null,
): BenchmarkBackendResult {
  const definition = BENCHMARK_BACKEND_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) {
    throw new Error(`Unknown benchmark backend: ${id}`);
  }

  return {
    ...definition,
    status,
    text: null,
    error,
    processingMs: null,
  };
}

function createInitialResults(status: BenchmarkBackendResult['status'], includeReconciliation: boolean): BenchmarkResponse['results'] {
  const results: BenchmarkResponse['results'] = {
    'gemini-transcribe': createResult('gemini-transcribe', status),
    'chirp-3-ar-MA': createResult('chirp-3-ar-MA', status),
    'gemini-audio-understanding': createResult('gemini-audio-understanding', status),
  };

  if (includeReconciliation) {
    results.reconciled = createResult('reconciled', status);
  }

  return results;
}

export const initialBenchmarkState: BenchmarkState = {
  status: 'idle',
  results: {},
  reconciliationEnabled: false,
  error: null,
};

export function benchmarkStarted(): BenchmarkState {
  return {
    status: 'running',
    results: createInitialResults('running', false),
    reconciliationEnabled: false,
    error: null,
  };
}

export function benchmarkCompleted(response: BenchmarkResponse): BenchmarkState {
  const results = Object.values(response.results);
  const hasSuccess = results.some((result) => result.status === 'succeeded');

  return {
    status: hasSuccess ? 'succeeded' : 'failed',
    results: response.results,
    reconciliationEnabled: response.reconciliationEnabled,
    error: null,
  };
}

export function benchmarkFailed(previous: BenchmarkState, error: string): BenchmarkState {
  const results = Object.fromEntries(
    Object.entries(previous.results).map(([id, result]) => [
      id,
      {
        ...result,
        status: 'failed',
        text: null,
        error,
      },
    ]),
  ) as BenchmarkResponse['results'];

  return {
    ...previous,
    status: 'failed',
    results,
    error,
  };
}

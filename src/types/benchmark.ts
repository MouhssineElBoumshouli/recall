export type BenchmarkBackendId =
  | 'gemini-transcribe'
  | 'chirp-3-ar-MA'
  | 'gemini-audio-understanding'
  | 'reconciled';

export type BenchmarkResultStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface BenchmarkDiagnostic {
  stage: 'before request' | 'during interactions.create' | 'while reading output';
  code: string | null;
  status: number | null;
}

export interface BenchmarkBackendResult {
  id: BenchmarkBackendId;
  label: string;
  model: string;
  languageConfiguration: string;
  status: BenchmarkResultStatus;
  text: string | null;
  error: string | null;
  processingMs: number | null;
  diagnostic?: BenchmarkDiagnostic | null;
}

export type BenchmarkResults = Partial<Record<BenchmarkBackendId, BenchmarkBackendResult>>;

export interface BenchmarkResponse {
  results: BenchmarkResults;
  reconciliationEnabled: boolean;
}

export type BenchmarkRunStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface BenchmarkState extends BenchmarkResponse {
  status: BenchmarkRunStatus;
  error: string | null;
}

export const BENCHMARK_BACKEND_DEFINITIONS: readonly (
  Pick<BenchmarkBackendResult, 'id' | 'label' | 'model' | 'languageConfiguration'>
)[] = [
  {
    id: 'gemini-transcribe',
    label: 'GEMINI TRANSCRIBE · A',
    model: 'gemini-3.5-transcribe',
    languageConfiguration: 'automatic detection · language_codes: [] · verbatim',
  },
  {
    id: 'chirp-3-ar-MA',
    label: 'CHIRP 3 ar-MA · B',
    model: 'chirp_3',
    languageConfiguration: 'Arabic (Morocco) · ar-MA',
  },
  {
    id: 'gemini-audio-understanding',
    label: 'GEMINI AUDIO UNDERSTANDING · C',
    model: 'gemini-3.7-flash',
    languageConfiguration: 'prompt-guided multilingual transcription',
  },
  {
    id: 'reconciled',
    label: 'RECONCILED · D',
    model: 'gemini-3.7-flash',
    languageConfiguration: 'audio-authoritative candidate comparison',
  },
];

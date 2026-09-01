import {
  DARIIJA_TRANSCRIPTION_INSTRUCTION,
  GEMINI_AUDIO_UNDERSTANDING_MODEL,
  GEMINI_FLASH_LITE_MODEL,
  NON_LIVE_TRANSCRIPTION_MODEL,
  WAV_MIME_TYPE,
  createGeminiInteractionDiagnostic,
  GeminiInteractionError,
  type GeminiTranscriptionGateway,
  type UploadedAudioFile,
} from './transcriptionService.js';
import {
  CHIRP3_LANGUAGE,
  CHIRP3_MODEL,
  type Chirp3TranscriptionGateway,
} from './chirp3TranscriptionService.js';
import type {
  BenchmarkBackendId,
  BenchmarkBackendResult,
  BenchmarkDiagnostic,
  BenchmarkResponse,
} from '../src/types/benchmark.js';

export interface BenchmarkServiceOptions {
  includeReconciled?: boolean;
}

interface BenchmarkDefinition {
  id: BenchmarkBackendId;
  label: string;
  model: string;
  languageConfiguration: string;
}

const DEFINITIONS: Record<BenchmarkBackendId, BenchmarkDefinition> = {
  'gemini-transcribe': {
    id: 'gemini-transcribe',
    label: 'GEMINI TRANSCRIBE · A',
    model: NON_LIVE_TRANSCRIPTION_MODEL,
    languageConfiguration: 'automatic detection · language_codes: [] · verbatim',
  },
  'chirp-3-ar-MA': {
    id: 'chirp-3-ar-MA',
    label: 'CHIRP 3 ar-MA · B',
    model: CHIRP3_MODEL,
    languageConfiguration: `Arabic (Morocco) · ${CHIRP3_LANGUAGE}`,
  },
  'gemini-audio-understanding': {
    id: 'gemini-audio-understanding',
    label: 'GEMINI AUDIO UNDERSTANDING · C',
    model: GEMINI_AUDIO_UNDERSTANDING_MODEL,
    languageConfiguration: 'prompt-guided multilingual transcription',
  },
  'gemini-flash-lite': {
    id: 'gemini-flash-lite',
    label: 'GEMINI FLASH-LITE · C2',
    model: GEMINI_FLASH_LITE_MODEL,
    languageConfiguration: 'prompt-guided multilingual transcription',
  },
  reconciled: {
    id: 'reconciled',
    label: 'RECONCILED · D',
    model: GEMINI_AUDIO_UNDERSTANDING_MODEL,
    languageConfiguration: 'audio-authoritative candidate comparison',
  },
};

function succeeded(id: BenchmarkBackendId, text: string, processingMs: number): BenchmarkBackendResult {
  return {
    ...DEFINITIONS[id],
    status: 'succeeded',
    text,
    error: null,
    processingMs,
    diagnostic: null,
  };
}

function failed(
  id: BenchmarkBackendId,
  error: string,
  processingMs: number | null = null,
  diagnostic: BenchmarkDiagnostic | null = null,
): BenchmarkBackendResult {
  return {
    ...DEFINITIONS[id],
    status: 'failed',
    text: null,
    error,
    processingMs,
    diagnostic,
  };
}

async function runGeminiTranscribe(
  gateway: GeminiTranscriptionGateway,
  uploadedFile: UploadedAudioFile | null,
): Promise<BenchmarkBackendResult> {
  const startedAt = Date.now();
  if (!uploadedFile?.uri) {
    return failed('gemini-transcribe', 'Gemini File upload failed.');
  }

  try {
    const text = await gateway.transcribe(uploadedFile.uri, uploadedFile.mimeType || WAV_MIME_TYPE, {
      customVocabulary: [],
    });
    return succeeded('gemini-transcribe', text, Date.now() - startedAt);
  } catch {
    return failed('gemini-transcribe', 'Gemini Transcribe failed.', Date.now() - startedAt);
  }
}

async function runGeminiAudioUnderstanding(
  gateway: GeminiTranscriptionGateway,
  uploadedFile: UploadedAudioFile | null,
  id: 'gemini-audio-understanding' | 'gemini-flash-lite',
  model: string,
): Promise<BenchmarkBackendResult> {
  const startedAt = Date.now();
  if (!uploadedFile?.uri) {
    return failed(id, 'Gemini File upload failed.');
  }

  try {
    const text = await gateway.understand(
      uploadedFile.uri,
      uploadedFile.mimeType || WAV_MIME_TYPE,
      DARIIJA_TRANSCRIPTION_INSTRUCTION,
      model,
    );
    return succeeded(id, text, Date.now() - startedAt);
  } catch (error) {
    if (error instanceof GeminiInteractionError) {
      console.error(`[benchmark] ${id} failed`, JSON.stringify(error.diagnostic));
      return failed(
        id,
        'Gemini audio-understanding transcription failed.',
        Date.now() - startedAt,
        {
          stage: error.diagnostic.stage,
          code: error.diagnostic.code,
          status: error.diagnostic.status,
        },
      );
    }

    const diagnostic = createGeminiInteractionDiagnostic(
      error,
      GEMINI_AUDIO_UNDERSTANDING_MODEL,
      'during interactions.create',
    );
    console.error(`[benchmark] ${id} failed`, JSON.stringify(diagnostic));
    return failed(
      id,
      'Gemini audio-understanding transcription failed.',
      Date.now() - startedAt,
      { stage: diagnostic.stage, code: diagnostic.code, status: diagnostic.status },
    );
  }
}

async function runChirp3(
  gateway: Chirp3TranscriptionGateway | null,
  filePath: string,
): Promise<BenchmarkBackendResult> {
  const startedAt = Date.now();
  if (!gateway) {
    return failed('chirp-3-ar-MA', 'Chirp 3 is not configured on this server.');
  }

  try {
    const text = await gateway.transcribe(filePath);
    return succeeded('chirp-3-ar-MA', text, Date.now() - startedAt);
  } catch {
    return failed('chirp-3-ar-MA', 'Chirp 3 transcription failed.', Date.now() - startedAt);
  }
}

function allIndependentResultsSucceeded(results: BenchmarkBackendResult[]): boolean {
  return results.every((result) => result.status === 'succeeded');
}

async function runReconciliation(
  gateway: GeminiTranscriptionGateway,
  uploadedFile: UploadedAudioFile | null,
  results: [BenchmarkBackendResult, BenchmarkBackendResult, BenchmarkBackendResult],
): Promise<BenchmarkBackendResult> {
  const startedAt = Date.now();
  if (!uploadedFile?.uri) {
    return failed('reconciled', 'Reconciliation requires a shared Gemini File.');
  }
  if (!allIndependentResultsSucceeded(results)) {
    return failed('reconciled', 'Reconciliation requires successful A, B, and C results.');
  }

  const candidateText = results
    .map((result) => `${result.label}:\n${result.text || ''}`)
    .join('\n\n');
  const instruction = [
    'Produce a faithful reconciled transcript by checking the candidate transcripts against the original audio.',
    'The audio is authoritative.',
    'Do not translate, summarize, paraphrase, or grammatically correct the speech.',
    'Preserve code-switching. Keep French and English in their own language.',
    'Moroccan Darija may appear in Arabic script.',
    'Do not invent missing content.',
    'Candidate transcripts:',
    candidateText,
  ].join('\n');

  try {
    const text = await gateway.understand(
      uploadedFile.uri,
      uploadedFile.mimeType || WAV_MIME_TYPE,
      instruction,
      GEMINI_AUDIO_UNDERSTANDING_MODEL,
    );
    return succeeded('reconciled', text, Date.now() - startedAt);
  } catch {
    return failed('reconciled', 'Reconciliation failed.', Date.now() - startedAt);
  }
}

export async function runBenchmark(
  geminiGateway: GeminiTranscriptionGateway,
  chirp3Gateway: Chirp3TranscriptionGateway | null,
  filePath: string,
  options: BenchmarkServiceOptions = {},
): Promise<BenchmarkResponse> {
  const includeReconciled = options.includeReconciled === true;
  let uploadedFile: UploadedAudioFile | null = null;

  try {
    try {
      uploadedFile = await geminiGateway.upload(filePath, WAV_MIME_TYPE);
    } catch {
      uploadedFile = null;
    }

    const independentResults = await Promise.all([
      runGeminiTranscribe(geminiGateway, uploadedFile),
      runChirp3(chirp3Gateway, filePath),
      runGeminiAudioUnderstanding(
        geminiGateway,
        uploadedFile,
        'gemini-audio-understanding',
        GEMINI_AUDIO_UNDERSTANDING_MODEL,
      ),
      runGeminiAudioUnderstanding(geminiGateway, uploadedFile, 'gemini-flash-lite', GEMINI_FLASH_LITE_MODEL),
    ]) as [BenchmarkBackendResult, BenchmarkBackendResult, BenchmarkBackendResult, BenchmarkBackendResult];

    const results: BenchmarkResponse['results'] = {
      'gemini-transcribe': independentResults[0],
      'chirp-3-ar-MA': independentResults[1],
      'gemini-audio-understanding': independentResults[2],
      'gemini-flash-lite': independentResults[3],
    };

    if (includeReconciled) {
      results.reconciled = await runReconciliation(geminiGateway, uploadedFile, [
        independentResults[0],
        independentResults[1],
        independentResults[2],
      ]);
    }

    return { results, reconciliationEnabled: includeReconciled };
  } finally {
    if (uploadedFile?.name) {
      try {
        await geminiGateway.delete(uploadedFile.name);
      } catch {
        console.error('Unable to delete the temporary Gemini benchmark upload.');
      }
    }
  }
}

import type { GoogleGenAI } from '@google/genai';
import type { TranscriptLanguageContext } from '../src/types/languageContext.js';

export type GeminiInteractionStage =
  | 'before request'
  | 'during interactions.create'
  | 'while reading output';

export interface GeminiInteractionDiagnostic {
  model: string;
  stage: GeminiInteractionStage;
  code: string | null;
  status: number | null;
  message: string;
}

export class GeminiInteractionError extends Error {
  readonly diagnostic: GeminiInteractionDiagnostic;

  constructor(diagnostic: GeminiInteractionDiagnostic) {
    super('Gemini audio-understanding request failed.');
    this.name = 'GeminiInteractionError';
    this.diagnostic = diagnostic;
  }
}

export const NON_LIVE_TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe';
export const GEMINI_AUDIO_UNDERSTANDING_MODEL = 'gemini-3.7-flash';
export const GEMINI_FLASH_LITE_MODEL = 'gemini-3.5-flash-lite';
export const WAV_MIME_TYPE = 'audio/wav';

export interface RefinedTranscriptionOptions {
  customVocabulary?: string[];
}

export interface SessionProcessingResult {
  rawFinalTranscript: string | null;
  repairedTranscript: string | null;
  error: string | null;
}

export interface TranscriptRepairProvider {
  repair(
    fileUri: string,
    mimeType: string,
    baselineTranscript: string,
    languageContext?: TranscriptLanguageContext,
  ): Promise<string>;
}

export interface UploadedAudioFile {
  name?: string;
  uri?: string;
  mimeType?: string;
}

export interface GeminiTranscriptionGateway extends TranscriptRepairProvider {
  upload(filePath: string, mimeType: string): Promise<UploadedAudioFile>;
  transcribe(
    fileUri: string,
    mimeType: string,
    options: RefinedTranscriptionOptions,
  ): Promise<string>;
  understand(
    fileUri: string,
    mimeType: string,
    instruction: string,
    model?: string,
  ): Promise<string>;
  delete(fileName: string): Promise<void>;
}

export type RefinementServiceErrorCode = 'GEMINI_UPLOAD_FAILED' | 'GEMINI_TRANSCRIPTION_FAILED';

export class RefinementServiceError extends Error {
  readonly code: RefinementServiceErrorCode;

  constructor(code: RefinementServiceErrorCode, message: string) {
    super(message);
    this.name = 'RefinementServiceError';
    this.code = code;
  }
}

function cleanVocabulary(vocabulary: string[] | undefined): string[] {
  return (vocabulary ?? [])
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .slice(0, 1_000);
}

function cleanContextValues(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 20);
}

export function normalizeTranscriptLanguageContext(
  context?: TranscriptLanguageContext,
): Required<TranscriptLanguageContext> {
  return {
    likelyLanguages: cleanContextValues(context?.likelyLanguages),
    localeHints: cleanContextValues(context?.localeHints),
    preserveCodeSwitching: context?.preserveCodeSwitching !== false,
  };
}

export function describeTranscriptLanguageContext(context?: TranscriptLanguageContext): string {
  const normalized = normalizeTranscriptLanguageContext(context);
  if (normalized.likelyLanguages.length === 0 && normalized.localeHints.length === 0) {
    return 'AUTO LANGUAGE CONTEXT';
  }

  const languageDescription = normalized.likelyLanguages.length > 0
    ? normalized.likelyLanguages.join(' · ')
    : 'unspecified languages';
  const localeDescription = normalized.localeHints.length > 0
    ? ` · locale: ${normalized.localeHints.join(' · ')}`
    : '';
  return `HINTED: ${languageDescription}${localeDescription}`;
}

export function buildTranscriptRepairInstruction(
  baselineTranscript: string,
  context?: TranscriptLanguageContext,
): string {
  const normalized = normalizeTranscriptLanguageContext(context);
  const instruction = [
    'You are repairing an automatic speech recognition transcript by checking it against the original audio.',
    'The original audio is authoritative.',
    'The supplied transcript may contain recognition errors.',
    'Correct only words or phrases that are clearly incorrect based on the audio.',
    'Preserve exactly which languages the speaker uses.',
    ...(normalized.preserveCodeSwitching ? ['Preserve natural code-switching.'] : []),
    'Do not translate between languages.',
    'Do not summarize.',
    'Do not paraphrase.',
    'Do not improve grammar or speaking style.',
    'Do not make the speaker sound more formal.',
    'Do not remove repetitions, filler words, false starts, or informal speech unless they were introduced incorrectly by the ASR system.',
    'Preserve proper nouns, technical vocabulary, names, numbers, and terminology when they can be verified from the audio.',
    'Preserve the natural writing system of each language where confidently identifiable.',
    'Do not convert dialectal speech into a standardized language merely because they are related.',
    'If the original ASR transcript is correct, leave it unchanged.',
    'If something cannot be determined confidently from the audio, prefer the original transcript over inventing content.',
    `BASE TRANSCRIPT:\n${baselineTranscript}`,
  ].join('\n');

  if (normalized.likelyLanguages.length === 0 && normalized.localeHints.length === 0) {
    return instruction;
  }

  return [
    instruction,
    '',
    'Additional context:',
    normalized.likelyLanguages.length > 0
      ? `Likely languages in this session: ${normalized.likelyLanguages.join(', ')}.`
      : 'No likely languages were supplied.',
    normalized.localeHints.length > 0
      ? `Locale hints: ${normalized.localeHints.join(', ')}.`
      : 'No locale hints were supplied.',
    ...(normalized.preserveCodeSwitching ? ['The speaker may switch languages without warning.'] : []),
    'These are hints only. The audio remains authoritative.',
  ].join('\n');
}

function redactProviderMessage(value: unknown): string {
  const message = String(value ?? 'Unknown Gemini error')
    .replace(/(?:https?|gs):\/\/\S+/gi, '[redacted-uri]')
    .replace(/(?:access_token|api_key|key|token)=([^\s&]+)/gi, (match) => `${match.split('=')[0]}=[redacted]`)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  return message.length > 400 ? `${message.slice(0, 397)}...` : message;
}

function readStatus(error: Record<string, unknown>): number | null {
  const direct = error.status;
  if (typeof direct === 'number') {
    return direct;
  }

  const response = error.response;
  if (response && typeof response === 'object' && typeof (response as Record<string, unknown>).status === 'number') {
    return (response as Record<string, unknown>).status as number;
  }

  return null;
}

export function createGeminiInteractionDiagnostic(
  error: unknown,
  model: string,
  stage: GeminiInteractionStage,
): GeminiInteractionDiagnostic {
  const candidate = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = candidate.code;
  return {
    model,
    stage,
    code: typeof code === 'string' || typeof code === 'number' ? String(code) : null,
    status: readStatus(candidate),
    message: redactProviderMessage(candidate.message ?? error),
  };
}

export function createGeminiTranscriptionGateway(ai: GoogleGenAI): GeminiTranscriptionGateway {
  return {
    async upload(filePath, mimeType) {
      return ai.files.upload({ file: filePath, config: { mimeType } });
    },

    async transcribe(fileUri, mimeType, options) {
      const customVocabulary = cleanVocabulary(options.customVocabulary);
      const transcriptionConfig = {
        language_codes: [],
        mode: { type: 'verbatim' as const },
        ...(customVocabulary.length > 0 ? { custom_vocabulary: customVocabulary } : {}),
      };
      const interaction = await ai.interactions.create({
        model: NON_LIVE_TRANSCRIPTION_MODEL,
        input: [{ type: 'audio', uri: fileUri, mime_type: mimeType }],
        generation_config: {
          transcription_config: transcriptionConfig,
        },
      });

      return interaction.output_text ?? '';
    },

    async understand(fileUri, mimeType, instruction, model = GEMINI_AUDIO_UNDERSTANDING_MODEL) {
      if (!fileUri || !mimeType || !instruction) {
        throw new GeminiInteractionError(
          createGeminiInteractionDiagnostic(
            new Error('Audio understanding request is missing required input.'),
            model,
            'before request',
          ),
        );
      }

      let interaction: { output_text?: string };
      try {
        interaction = await ai.interactions.create({
          model,
          input: [
            { type: 'text', text: instruction },
            { type: 'audio', uri: fileUri, mime_type: mimeType },
          ],
        });
      } catch (error) {
        throw new GeminiInteractionError(
          createGeminiInteractionDiagnostic(
            error,
            model,
            'during interactions.create',
          ),
        );
      }

      try {
        return interaction.output_text ?? '';
      } catch (error) {
        throw new GeminiInteractionError(
          createGeminiInteractionDiagnostic(
            error,
            model,
            'while reading output',
          ),
        );
      }
    },

    async repair(fileUri, mimeType, baselineTranscript, languageContext) {
      if (!fileUri || !mimeType) {
        throw new GeminiInteractionError(
          createGeminiInteractionDiagnostic(
            new Error('Transcript repair request is missing audio input.'),
            GEMINI_FLASH_LITE_MODEL,
            'before request',
          ),
        );
      }

      let interaction: { output_text?: string };
      try {
        interaction = await ai.interactions.create({
          model: GEMINI_FLASH_LITE_MODEL,
          input: [
            {
              type: 'text',
              text: buildTranscriptRepairInstruction(baselineTranscript, languageContext),
            },
            { type: 'audio', uri: fileUri, mime_type: mimeType },
          ],
        });
      } catch (error) {
        throw new GeminiInteractionError(
          createGeminiInteractionDiagnostic(
            error,
            GEMINI_FLASH_LITE_MODEL,
            'during interactions.create',
          ),
        );
      }

      try {
        return interaction.output_text ?? '';
      } catch (error) {
        throw new GeminiInteractionError(
          createGeminiInteractionDiagnostic(
            error,
            GEMINI_FLASH_LITE_MODEL,
            'while reading output',
          ),
        );
      }
    },

    async delete(fileName) {
      await ai.files.delete({ name: fileName });
    },
  };
}

export async function transcribeWavFile(
  gateway: GeminiTranscriptionGateway,
  filePath: string,
  options: RefinedTranscriptionOptions = {},
): Promise<{ model: string; text: string }> {
  let uploadedFile: UploadedAudioFile | null = null;

  try {
    try {
      uploadedFile = await gateway.upload(filePath, WAV_MIME_TYPE);
    } catch {
      throw new RefinementServiceError('GEMINI_UPLOAD_FAILED', 'Gemini Files upload failed.');
    }
    if (!uploadedFile.uri) {
      throw new RefinementServiceError('GEMINI_UPLOAD_FAILED', 'Gemini Files upload returned no audio URI.');
    }

    let text: string;
    try {
      text = await gateway.transcribe(uploadedFile.uri, uploadedFile.mimeType || WAV_MIME_TYPE, options);
    } catch {
      throw new RefinementServiceError('GEMINI_TRANSCRIPTION_FAILED', 'Gemini transcription failed.');
    }
    return { model: NON_LIVE_TRANSCRIPTION_MODEL, text };
  } finally {
    if (uploadedFile?.name) {
      try {
        await gateway.delete(uploadedFile.name);
      } catch {
        console.error('Unable to delete the temporary Gemini audio upload.');
      }
    }
  }
}

export async function processSessionWavFile(
  gateway: GeminiTranscriptionGateway,
  filePath: string,
  languageContext?: TranscriptLanguageContext,
): Promise<SessionProcessingResult> {
  let uploadedFile: UploadedAudioFile | null = null;

  try {
    try {
      uploadedFile = await gateway.upload(filePath, WAV_MIME_TYPE);
    } catch {
      throw new RefinementServiceError('GEMINI_UPLOAD_FAILED', 'Gemini Files upload failed.');
    }
    if (!uploadedFile.uri) {
      throw new RefinementServiceError('GEMINI_UPLOAD_FAILED', 'Gemini Files upload returned no audio URI.');
    }

    let rawFinalTranscript: string | null = null;
    let error: string | null = null;
    try {
      rawFinalTranscript = await gateway.transcribe(uploadedFile.uri, uploadedFile.mimeType || WAV_MIME_TYPE, {
        customVocabulary: [],
      });
    } catch {
      error = 'Gemini transcription failed.';
    }

    let repairedTranscript: string | null = null;
    if (rawFinalTranscript?.trim()) {
      try {
        repairedTranscript = await gateway.repair(
          uploadedFile.uri,
          uploadedFile.mimeType || WAV_MIME_TYPE,
          rawFinalTranscript,
          languageContext,
        );
      } catch {
        error = error || 'Audio-grounded transcript repair failed.';
      }
    } else if (!error) {
      error = 'Gemini transcription returned no text.';
    }

    return { rawFinalTranscript, repairedTranscript, error };
  } finally {
    if (uploadedFile?.name) {
      try {
        await gateway.delete(uploadedFile.name);
      } catch {
        console.error('Unable to delete the temporary Gemini session upload.');
      }
    }
  }
}

import type { GoogleGenAI } from '@google/genai';

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
export const WAV_MIME_TYPE = 'audio/wav';

export const DARIIJA_TRANSCRIPTION_INSTRUCTION = [
  'You are transcribing speech, not summarizing it.',
  'The speaker is Moroccan and may naturally code-switch between Moroccan Darija, French, and English.',
  'Transcribe exactly what is spoken.',
  'Do not translate, summarize, paraphrase, or grammatically correct the speech.',
  'Preserve French words as French and English words as English.',
  'Do not replace Moroccan Darija with Modern Standard Arabic.',
  'For Moroccan Darija, use Arabic script where possible.',
  'If a word is genuinely uncertain, do not invent unrelated content.',
].join(' ');

export interface RefinedTranscriptionOptions {
  customVocabulary?: string[];
}

export interface UploadedAudioFile {
  name?: string;
  uri?: string;
  mimeType?: string;
}

export interface GeminiTranscriptionGateway {
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

    async understand(fileUri, mimeType, instruction) {
      if (!fileUri || !mimeType || !instruction) {
        throw new GeminiInteractionError(
          createGeminiInteractionDiagnostic(
            new Error('Audio understanding request is missing required input.'),
            GEMINI_AUDIO_UNDERSTANDING_MODEL,
            'before request',
          ),
        );
      }

      let interaction: { output_text?: string };
      try {
        interaction = await ai.interactions.create({
          model: GEMINI_AUDIO_UNDERSTANDING_MODEL,
          input: [
            { type: 'text', text: instruction },
            { type: 'audio', uri: fileUri, mime_type: mimeType },
          ],
        });
      } catch (error) {
        throw new GeminiInteractionError(
          createGeminiInteractionDiagnostic(
            error,
            GEMINI_AUDIO_UNDERSTANDING_MODEL,
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
            GEMINI_AUDIO_UNDERSTANDING_MODEL,
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

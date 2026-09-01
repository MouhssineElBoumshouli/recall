import type { GoogleGenAI } from '@google/genai';

export const NON_LIVE_TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe';
export const WAV_MIME_TYPE = 'audio/wav';

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

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
    uploadedFile = await gateway.upload(filePath, WAV_MIME_TYPE);
    if (!uploadedFile.uri) {
      throw new Error('Gemini did not return an uploaded audio URI.');
    }

    const text = await gateway.transcribe(uploadedFile.uri, uploadedFile.mimeType || WAV_MIME_TYPE, options);
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

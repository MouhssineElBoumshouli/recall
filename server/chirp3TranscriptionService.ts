import { readFile } from 'node:fs/promises';
import { v2 as speechV2, type protos } from '@google-cloud/speech';

export const CHIRP3_MODEL = 'chirp_3';
export const CHIRP3_LANGUAGE = 'ar-MA';
export const DEFAULT_CHIRP3_LOCATION = 'us';

type SpeechV2Client = {
  recognize(
    request: protos.google.cloud.speech.v2.IRecognizeRequest,
  ): Promise<[protos.google.cloud.speech.v2.IRecognizeResponse, ...unknown[]]>;
};

export interface Chirp3TranscriptionGateway {
  transcribe(filePath: string): Promise<string>;
}

export interface Chirp3TranscriptionConfig {
  projectId: string;
  location?: string;
  client?: SpeechV2Client;
}

function joinTranscripts(response: protos.google.cloud.speech.v2.IRecognizeResponse): string {
  return (response.results || [])
    .map((result) => result.alternatives?.[0]?.transcript?.trim())
    .filter((transcript): transcript is string => Boolean(transcript))
    .join('\n');
}

export function createChirp3TranscriptionGateway(config: Chirp3TranscriptionConfig): Chirp3TranscriptionGateway {
  const location = config.location || DEFAULT_CHIRP3_LOCATION;
  const client =
    config.client ||
    new speechV2.SpeechClient({
      projectId: config.projectId,
      apiEndpoint: `${location}-speech.googleapis.com`,
    });

  return {
    async transcribe(filePath) {
      const content = await readFile(filePath);
      const [response] = await client.recognize({
        recognizer: `projects/${config.projectId}/locations/${location}/recognizers/_`,
        config: {
          autoDecodingConfig: {},
          languageCodes: [CHIRP3_LANGUAGE],
          model: CHIRP3_MODEL,
        },
        content,
      });

      return joinTranscripts(response);
    },
  };
}

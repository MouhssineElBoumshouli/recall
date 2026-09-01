import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';

import { createGeminiTranscriptionGateway, transcribeWavFile } from './transcriptionService.js';
import { validateWavBuffer } from './wavValidation.js';

config();

const port = Number(process.env.TOKEN_SERVER_PORT || 8_787);
const apiKey = process.env.GEMINI_API_KEY;
const model = 'gemini-3.5-transcribe-live';
const maxTranscriptionBytes = 50 * 1024 * 1024;

class RequestBodyTooLargeError extends Error {}

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readRequestBody(request: import('node:http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    request.on('data', (chunk: Buffer | string) => {
      if (settled) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxTranscriptionBytes) {
        settled = true;
        reject(new RequestBodyTooLargeError('Audio exceeds the Phase 0.5 upload limit.'));
        return;
      }

      chunks.push(buffer);
    });
    request.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    request.on('aborted', () => {
      if (!settled) {
        settled = true;
        reject(new Error('Audio upload was aborted.'));
      }
    });
    request.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function parseCustomVocabulary(request: import('node:http').IncomingMessage): string[] {
  const rawValue = request.headers['x-recall-custom-vocabulary'];
  if (!rawValue) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(Array.isArray(rawValue) ? rawValue[0] : rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((phrase): phrase is string => typeof phrase === 'string')
      .map((phrase) => phrase.trim())
      .filter(Boolean)
      .slice(0, 1_000);
  } catch {
    return [];
  }
}

if (!apiKey) {
  console.error('GEMINI_API_KEY is required to start the token server.');
  process.exitCode = 1;
} else {
  const ai = new GoogleGenAI({ apiKey });
  const transcriptionGateway = createGeminiTranscriptionGateway(ai);

  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Recall-Custom-Vocabulary');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;

    if (request.method === 'GET' && pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && pathname === '/token') {
      try {
        const expireTime = new Date(Date.now() + 30 * 60 * 1_000).toISOString();
        const newSessionExpireTime = new Date(Date.now() + 15 * 60 * 1_000).toISOString();
        const token = await ai.authTokens.create({
          config: {
            uses: 1,
            expireTime,
            newSessionExpireTime,
            liveConnectConstraints: {
              model,
              config: {
                responseModalities: [Modality.TEXT],
                inputAudioTranscription: { languageCodes: [] },
              },
            },
            lockAdditionalFields: ['responseModalities', 'inputAudioTranscription'],
          },
        });

        if (!token.name) {
          throw new Error('Gemini returned an empty ephemeral token');
        }

        sendJson(response, 200, { token: token.name, expiresAt: token.expireTime });
      } catch (error) {
        console.error(
          'Unable to create Gemini ephemeral token:',
          error instanceof Error ? error.message : 'unknown error',
        );
        sendJson(response, 502, { error: 'Unable to create an ephemeral Gemini token.' });
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/transcribe') {
      const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'audio/wav') {
        sendJson(response, 415, { error: 'Content-Type must be audio/wav.' });
        return;
      }

      const contentLength = Number(request.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxTranscriptionBytes) {
        sendJson(response, 413, { error: 'Audio exceeds the Phase 0.5 upload limit.' });
        return;
      }

      let temporaryDirectory: string | null = null;
      try {
        const audio = await readRequestBody(request);
        const validation = validateWavBuffer(audio);
        if (!validation.valid) {
          sendJson(response, 400, { error: validation.error || 'Invalid WAV audio.' });
          return;
        }

        temporaryDirectory = await mkdtemp(join(tmpdir(), 'recall-transcribe-'));
        const temporaryFile = join(temporaryDirectory, 'recording.wav');
        await writeFile(temporaryFile, audio);
        const result = await transcribeWavFile(transcriptionGateway, temporaryFile, {
          customVocabulary: parseCustomVocabulary(request),
        });

        sendJson(response, 200, result);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          sendJson(response, 413, { error: 'Audio exceeds the Phase 0.5 upload limit.' });
        } else {
          console.error(
            'Unable to refine uploaded audio:',
            error instanceof Error ? error.message : 'unknown error',
          );
          sendJson(response, 502, { error: 'Unable to refine the recording transcript.' });
        }
      } finally {
        if (temporaryDirectory) {
          await rm(temporaryDirectory, { recursive: true, force: true });
        }
      }
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Recall token server listening on http://0.0.0.0:${port}`);
  });
}

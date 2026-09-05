import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';

import { createChirp3TranscriptionGateway } from './chirp3TranscriptionService.js';
import { runBenchmark } from './benchmarkService.js';
import {
  createGeminiTranscriptionGateway,
  processSessionWavFile,
  RefinementServiceError,
  transcribeWavFile,
} from './transcriptionService.js';
import {
  createGeminiSessionIntelligenceProvider,
  SessionIntelligenceProviderError,
  SESSION_INTELLIGENCE_MODEL,
} from './sessionIntelligenceService.js';
import {
  isWithinTranscriptionLimit,
  normalizeContentType,
  validateWavRequest,
} from './wavValidation.js';
import type { TranscriptLanguageContext } from '../src/types/languageContext.js';

config();

const port = Number(process.env.TOKEN_SERVER_PORT || 8_787);
const apiKey = process.env.GEMINI_API_KEY;
const model = 'gemini-3.5-transcribe-live';
const cloudProjectId = process.env.GOOGLE_CLOUD_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const cloudLocation = process.env.GOOGLE_CLOUD_SPEECH_LOCATION || 'us';
const reconciliationEnabled = process.env.RECALL_ENABLE_RECONCILIATION === 'true';
const benchmarkLanguageContext: TranscriptLanguageContext = process.env.RECALL_BENCHMARK_LANGUAGE_MODE === 'auto'
  ? { preserveCodeSwitching: true }
  : {
      likelyLanguages: ['Moroccan Darija', 'French', 'English'],
      localeHints: ['Morocco'],
      preserveCodeSwitching: true,
    };
class RequestBodyTooLargeError extends Error {}
const MAX_INTELLIGENCE_REQUEST_BYTES = 2_000_000;

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readRequestBody(
  request: import('node:http').IncomingMessage,
  maxBytes = 50 * 1024 * 1024,
): Promise<Buffer> {
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
      if (totalBytes > maxBytes || (maxBytes === 50 * 1024 * 1024 && !isWithinTranscriptionLimit(totalBytes))) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseIntelligenceInput(value: unknown) {
  if (!isRecord(value) || typeof value.preferredTranscript !== 'string' || !value.preferredTranscript.trim()) {
    return null;
  }

  const languageContext = isRecord(value.languageContext) ? value.languageContext as TranscriptLanguageContext : null;
  const metadata = isRecord(value.sessionMetadata) &&
    typeof value.sessionMetadata.sessionId === 'string' &&
    typeof value.sessionMetadata.title === 'string' &&
    typeof value.sessionMetadata.recordedAt === 'string' &&
    typeof value.sessionMetadata.durationMs === 'number'
    ? {
        sessionId: value.sessionMetadata.sessionId,
        title: value.sessionMetadata.title,
        recordedAt: value.sessionMetadata.recordedAt,
        durationMs: value.sessionMetadata.durationMs,
      }
    : undefined;

  return {
    preferredTranscript: value.preferredTranscript,
    languageContext,
    ...(metadata ? { sessionMetadata: metadata } : {}),
  };
}

if (!apiKey) {
  console.error('GEMINI_API_KEY is required to start the token server.');
  process.exitCode = 1;
} else {
  const ai = new GoogleGenAI({ apiKey });
  const transcriptionGateway = createGeminiTranscriptionGateway(ai);
  const intelligenceProvider = createGeminiSessionIntelligenceProvider(ai);
  const chirp3Gateway = cloudProjectId
    ? createChirp3TranscriptionGateway({ projectId: cloudProjectId, location: cloudLocation })
    : null;

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
      const rawContentType = request.headers['content-type'];
      const contentTypeHeader = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
      const contentType = normalizeContentType(contentTypeHeader);
      console.info(
        `[transcribe] received content-type=${contentType || 'missing'} content-length=${request.headers['content-length'] || 'missing'}`,
      );

      const contentLength = Number(request.headers['content-length']);
      if (Number.isFinite(contentLength) && !isWithinTranscriptionLimit(contentLength)) {
        sendJson(response, 413, { code: 'AUDIO_TOO_LARGE', error: 'Audio exceeds the Phase 0.5 upload limit.' });
        return;
      }

      let temporaryDirectory: string | null = null;
      try {
        const audio = await readRequestBody(request);
        const validation = validateWavRequest(contentType || undefined, audio);
        if (!validation.valid) {
          sendJson(response, validation.statusCode, {
            code: validation.code,
            error: validation.error || 'Invalid WAV audio.',
          });
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
          sendJson(response, 413, { code: 'AUDIO_TOO_LARGE', error: 'Audio exceeds the Phase 0.5 upload limit.' });
        } else if (error instanceof RefinementServiceError) {
          sendJson(response, 502, { code: error.code, error: error.message });
        } else {
          console.error('Unable to refine uploaded audio: unexpected server error.');
          sendJson(response, 502, { code: 'REFINEMENT_FAILED', error: 'Unable to refine the recording transcript.' });
        }
      } finally {
        if (temporaryDirectory) {
          await rm(temporaryDirectory, { recursive: true, force: true });
        }
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/process') {
      const rawContentType = request.headers['content-type'];
      const contentTypeHeader = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
      const contentType = normalizeContentType(contentTypeHeader);
      console.info(
        `[process] received content-type=${contentType || 'missing'} content-length=${request.headers['content-length'] || 'missing'}`,
      );

      const contentLength = Number(request.headers['content-length']);
      if (Number.isFinite(contentLength) && !isWithinTranscriptionLimit(contentLength)) {
        sendJson(response, 413, { code: 'AUDIO_TOO_LARGE', error: 'Audio exceeds the Phase 1 upload limit.' });
        return;
      }

      let temporaryDirectory: string | null = null;
      try {
        const audio = await readRequestBody(request);
        const validation = validateWavRequest(contentType || undefined, audio);
        if (!validation.valid) {
          sendJson(response, validation.statusCode, {
            code: validation.code,
            error: validation.error || 'Invalid WAV audio.',
          });
          return;
        }

        temporaryDirectory = await mkdtemp(join(tmpdir(), 'recall-process-'));
        const temporaryFile = join(temporaryDirectory, 'recording.wav');
        await writeFile(temporaryFile, audio);
        const result = await processSessionWavFile(transcriptionGateway, temporaryFile);
        sendJson(response, 200, result);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          sendJson(response, 413, { code: 'AUDIO_TOO_LARGE', error: 'Audio exceeds the Phase 1 upload limit.' });
        } else if (error instanceof RefinementServiceError) {
          sendJson(response, 502, { code: error.code, error: error.message });
        } else {
          console.error('Unable to process saved session audio: unexpected server error.');
          sendJson(response, 502, { code: 'SESSION_PROCESSING_FAILED', error: 'Unable to process the session transcript.' });
        }
      } finally {
        if (temporaryDirectory) {
          await rm(temporaryDirectory, { recursive: true, force: true });
        }
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/intelligence') {
      const rawContentType = request.headers['content-type'];
      const contentTypeHeader = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
      const contentType = normalizeContentType(contentTypeHeader);
      if (!contentType || !contentType.startsWith('application/json')) {
        sendJson(response, 415, { code: 'UNSUPPORTED_REQUEST', error: 'Session intelligence requires a JSON request.' });
        return;
      }

      try {
        const body = await readRequestBody(request, MAX_INTELLIGENCE_REQUEST_BYTES);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          sendJson(response, 400, { code: 'INVALID_REQUEST', error: 'Session intelligence request is invalid.' });
          return;
        }

        const input = parseIntelligenceInput(parsed);
        if (!input) {
          sendJson(response, 400, { code: 'NO_PREFERRED_TRANSCRIPT', error: 'A preferred transcript is required.' });
          return;
        }

        const intelligence = await intelligenceProvider.generate(input);
        sendJson(response, 200, { ok: true, intelligence });
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          sendJson(response, 413, { code: 'INTELLIGENCE_REQUEST_TOO_LARGE', error: 'The transcript is too large to process.' });
        } else if (error instanceof SessionIntelligenceProviderError) {
          console.error('[intelligence] provider failure', {
            model: SESSION_INTELLIGENCE_MODEL,
            code: error.code,
          });
          sendJson(response, 502, { code: error.code, error: error.message });
        } else {
          console.error('[intelligence] unexpected generation failure');
          sendJson(response, 502, { code: 'INTELLIGENCE_FAILED', error: 'Unable to generate session intelligence.' });
        }
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/benchmark') {
      const rawContentType = request.headers['content-type'];
      const contentTypeHeader = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
      const contentType = normalizeContentType(contentTypeHeader);
      console.info(
        `[benchmark] received content-type=${contentType || 'missing'} content-length=${request.headers['content-length'] || 'missing'}`,
      );

      const contentLength = Number(request.headers['content-length']);
      if (Number.isFinite(contentLength) && !isWithinTranscriptionLimit(contentLength)) {
        sendJson(response, 413, { code: 'AUDIO_TOO_LARGE', error: 'Audio exceeds the Phase 0.5 upload limit.' });
        return;
      }

      let temporaryDirectory: string | null = null;
      try {
        const audio = await readRequestBody(request);
        const validation = validateWavRequest(contentType || undefined, audio);
        if (!validation.valid) {
          sendJson(response, validation.statusCode, {
            code: validation.code,
            error: validation.error || 'Invalid WAV audio.',
          });
          return;
        }

        temporaryDirectory = await mkdtemp(join(tmpdir(), 'recall-benchmark-'));
        const temporaryFile = join(temporaryDirectory, 'recording.wav');
        await writeFile(temporaryFile, audio);
        const result = await runBenchmark(transcriptionGateway, chirp3Gateway, temporaryFile, {
          includeReconciled: reconciliationEnabled,
          transcriptLanguageContext: benchmarkLanguageContext,
        });
        sendJson(response, 200, result);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          sendJson(response, 413, { code: 'AUDIO_TOO_LARGE', error: 'Audio exceeds the Phase 0.5 upload limit.' });
        } else {
          console.error('Unable to run transcription benchmark: unexpected server error.');
          sendJson(response, 502, { code: 'BENCHMARK_FAILED', error: 'Unable to run the transcription benchmark.' });
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

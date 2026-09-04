import { describe, expect, it, vi } from 'vitest';

import {
  createGeminiTranscriptionGateway,
  buildTranscriptRepairInstruction,
  GeminiInteractionError,
  RefinementServiceError,
  processSessionWavFile,
  transcribeWavFile,
  type GeminiTranscriptionGateway,
} from '../server/transcriptionService';
import type { GoogleGenAI } from '@google/genai';
import {
  isWithinTranscriptionLimit,
  MAX_TRANSCRIPTION_BYTES,
  validateWavBuffer,
  validateWavRequest,
} from '../server/wavValidation';

function validWav(): Buffer {
  const dataBytes = 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

describe('WAV validation', () => {
  it('accepts a mono PCM16 WAV and returns useful metadata', () => {
    const result = validateWavBuffer(validWav());

    expect(result.valid).toBe(true);
    expect(result.metadata).toMatchObject({
      audioFormat: 1,
      channels: 1,
      sampleRate: 16_000,
      bitsPerSample: 16,
      dataBytes: 4,
    });
  });

  it.each([
    ['audio/wav', 'audio/wav'],
    ['audio/x-wav', 'audio/x-wav'],
    ['audio/wave', 'audio/wave'],
    ['audio/vnd.wave', 'audio/vnd.wave'],
    ['Android octet-stream', 'application/octet-stream'],
    ['missing MIME', undefined],
  ])('accepts valid WAV bytes with %s', (_label, contentType) => {
    const result = validateWavRequest(contentType, validWav());

    expect(result.valid).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('rejects missing and invalid audio without contacting Gemini', () => {
    const missing = validateWavRequest('audio/wav', null);
    const invalid = validateWavRequest('audio/wav', Buffer.from('not audio'));
    const missingWithUnhelpfulMime = validateWavRequest('text/plain', Buffer.alloc(0));

    expect(missing).toMatchObject({ valid: false, statusCode: 400, code: 'MISSING_AUDIO' });
    expect(invalid).toMatchObject({ valid: false, statusCode: 400, code: 'INVALID_WAV' });
    expect(missingWithUnhelpfulMime).toMatchObject({ valid: false, statusCode: 400, code: 'MISSING_AUDIO' });
  });

  it('rejects an unsupported transport MIME only when the bytes are not a WAV', () => {
    const result = validateWavRequest('text/plain', Buffer.from('not audio'));

    expect(result).toMatchObject({
      valid: false,
      statusCode: 415,
      code: 'UNSUPPORTED_TRANSPORT_MIME',
    });
  });

  it('rejects invalid bytes even when the MIME says audio/wav', () => {
    const result = validateWavRequest('audio/wav', Buffer.from('not audio'));

    expect(result.valid).toBe(false);
    expect(result.code).toBe('INVALID_WAV');
    expect(result.metadata).toBeNull();
  });

  it('retains the 50 MB upload limit', () => {
    expect(isWithinTranscriptionLimit(MAX_TRANSCRIPTION_BYTES)).toBe(true);
    expect(isWithinTranscriptionLimit(MAX_TRANSCRIPTION_BYTES + 1)).toBe(false);
  });
});

describe('transcribeWavFile', () => {
  it('uses the current Files API and Interactions transcription configuration', async () => {
    const upload = vi.fn().mockResolvedValue({
      name: 'files/temporary',
      uri: 'https://files.example/audio',
      mimeType: 'audio/wav',
    });
    const create = vi.fn().mockResolvedValue({ output_text: 'Current API transcript.' });
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const ai = {
      files: { upload, delete: deleteFile },
      interactions: { create },
    } as unknown as GoogleGenAI;
    const gateway = createGeminiTranscriptionGateway(ai);

    const uploaded = await gateway.upload('temporary.wav', 'audio/wav');
    const text = await gateway.transcribe(uploaded.uri || '', uploaded.mimeType || 'audio/wav', {
      customVocabulary: [],
    });
    await gateway.delete(uploaded.name || '');

    expect(text).toBe('Current API transcript.');
    expect(upload).toHaveBeenCalledWith({ file: 'temporary.wav', config: { mimeType: 'audio/wav' } });
    expect(create).toHaveBeenCalledWith({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', uri: 'https://files.example/audio', mime_type: 'audio/wav' }],
      generation_config: {
        transcription_config: {
          language_codes: [],
          mode: { type: 'verbatim' },
        },
      },
    });
    expect(deleteFile).toHaveBeenCalledWith({ name: 'files/temporary' });
  });

  it('uses the current Gemini audio-understanding model with the strict transcription instruction', async () => {
    const upload = vi.fn().mockResolvedValue({
      name: 'files/temporary',
      uri: 'https://files.example/audio',
      mimeType: 'audio/wav',
    });
    const create = vi.fn().mockResolvedValue({ output_text: 'Audio understanding transcript.' });
    const ai = {
      files: { upload, delete: vi.fn() },
      interactions: { create },
    } as unknown as GoogleGenAI;
    const gateway = createGeminiTranscriptionGateway(ai);

    await gateway.understand('https://files.example/audio', 'audio/wav', 'transcribe exactly');

    expect(create).toHaveBeenCalledWith({
      model: 'gemini-3.7-flash',
      input: [
        { type: 'text', text: 'transcribe exactly' },
        { type: 'audio', uri: 'https://files.example/audio', mime_type: 'audio/wav' },
      ],
    });
  });

  it('can send the same text-first audio request to the Flash-Lite benchmark model', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: 'Flash-Lite transcript.' });
    const ai = {
      files: { upload: vi.fn(), delete: vi.fn() },
      interactions: { create },
    } as unknown as GoogleGenAI;
    const gateway = createGeminiTranscriptionGateway(ai);

    await gateway.understand('https://files.example/audio', 'audio/wav', 'transcribe exactly', 'gemini-3.5-flash-lite');

    expect(create).toHaveBeenCalledWith({
      model: 'gemini-3.5-flash-lite',
      input: [
        { type: 'text', text: 'transcribe exactly' },
        { type: 'audio', uri: 'https://files.example/audio', mime_type: 'audio/wav' },
      ],
    });
  });

  it('preserves safe diagnostics for an audio-understanding provider failure', async () => {
    const providerError = Object.assign(
      new Error('429 quota exceeded at https://generativelanguage.googleapis.com/v1beta/interactions?key=secret'),
      { status: 429, code: 'too_many_requests' },
    );
    const create = vi.fn().mockRejectedValue(providerError);
    const ai = {
      files: { upload: vi.fn(), delete: vi.fn() },
      interactions: { create },
    } as unknown as GoogleGenAI;
    const gateway = createGeminiTranscriptionGateway(ai);

    await expect(gateway.understand('https://files.example/audio', 'audio/wav', 'transcribe exactly'))
      .rejects.toMatchObject({
        name: 'GeminiInteractionError',
        diagnostic: {
          model: 'gemini-3.7-flash',
          stage: 'during interactions.create',
          code: 'too_many_requests',
          status: 429,
          message: expect.not.stringContaining('secret'),
        },
      });
    await expect(gateway.understand('https://files.example/audio', 'audio/wav', 'transcribe exactly'))
      .rejects.toBeInstanceOf(GeminiInteractionError);
  });

  it('reports output-reading failures with a separate stage', async () => {
    const response = {} as { output_text?: string };
    Object.defineProperty(response, 'output_text', {
      get: () => {
        throw new Error('output accessor failed');
      },
    });
    const ai = {
      files: { upload: vi.fn(), delete: vi.fn() },
      interactions: { create: vi.fn().mockResolvedValue(response) },
    } as unknown as GoogleGenAI;
    const gateway = createGeminiTranscriptionGateway(ai);

    await expect(gateway.understand('https://files.example/audio', 'audio/wav', 'transcribe exactly'))
      .rejects.toMatchObject({ diagnostic: { stage: 'while reading output' } });
  });

  it('uploads, transcribes, and deletes the temporary Gemini file', async () => {
    const gateway: GeminiTranscriptionGateway = {
      upload: vi.fn().mockResolvedValue({ name: 'files/temporary', uri: 'https://files.example/audio', mimeType: 'audio/wav' }),
      transcribe: vi.fn().mockResolvedValue('Refined transcript.'),
      understand: vi.fn().mockResolvedValue('Audio understanding transcript.'),
      repair: vi.fn().mockResolvedValue('Repaired transcript.'),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(transcribeWavFile(gateway, 'temporary.wav')).resolves.toEqual({
      model: 'gemini-3.5-transcribe',
      text: 'Refined transcript.',
    });
    expect(gateway.upload).toHaveBeenCalledWith('temporary.wav', 'audio/wav');
    expect(gateway.transcribe).toHaveBeenCalledWith(
      'https://files.example/audio',
      'audio/wav',
      { customVocabulary: undefined },
    );
    expect(gateway.delete).toHaveBeenCalledWith('files/temporary');
  });

  it('cleans up the uploaded file even when Gemini transcription fails', async () => {
    const gateway: GeminiTranscriptionGateway = {
      upload: vi.fn().mockResolvedValue({ name: 'files/temporary', uri: 'https://files.example/audio' }),
      transcribe: vi.fn().mockRejectedValue(new Error('Gemini unavailable')),
      understand: vi.fn(),
      repair: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(transcribeWavFile(gateway, 'temporary.wav')).rejects.toMatchObject({
      code: 'GEMINI_TRANSCRIPTION_FAILED',
      message: 'Gemini transcription failed.',
    });
    expect(gateway.delete).toHaveBeenCalledWith('files/temporary');
  });

  it('reports a Gemini Files upload failure without exposing the underlying error', async () => {
    const gateway: GeminiTranscriptionGateway = {
      upload: vi.fn().mockRejectedValue(new Error('secret provider details')),
      transcribe: vi.fn(),
      understand: vi.fn(),
      repair: vi.fn(),
      delete: vi.fn(),
    };

    await expect(transcribeWavFile(gateway, 'temporary.wav')).rejects.toMatchObject({
      code: 'GEMINI_UPLOAD_FAILED',
      message: 'Gemini Files upload failed.',
    });
    expect(gateway.transcribe).not.toHaveBeenCalled();
  });

  it('builds a generic repair instruction with no language-specific requirement', () => {
    const instruction = buildTranscriptRepairInstruction('Hello there.');

    expect(instruction).toContain('The original audio is authoritative.');
    expect(instruction).toContain('Preserve natural code-switching.');
    expect(instruction).toContain('Do not translate between languages.');
    expect(instruction).toContain('Do not summarize.');
    expect(instruction).toContain('Do not paraphrase.');
    expect(instruction).not.toMatch(/Moroccan|Darija|Arabic|French|Morocco/i);
    expect(instruction).toContain('BASE TRANSCRIPT:\nHello there.');
  });

  it('appends language context as advisory hints', () => {
    const instruction = buildTranscriptRepairInstruction('Baseline.', {
      likelyLanguages: ['Japanese', 'English'],
      localeHints: ['Japan'],
      preserveCodeSwitching: true,
    });

    expect(instruction).toContain('Additional context:');
    expect(instruction).toContain('Likely languages in this session: Japanese, English.');
    expect(instruction).toContain('Locale hints: Japan.');
    expect(instruction).toContain('These are hints only. The audio remains authoritative.');
  });

  it('sends D2 text first, audio second, with A baseline and no C2 input', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: 'Repaired transcript.' });
    const ai = {
      files: { upload: vi.fn(), delete: vi.fn() },
      interactions: { create },
    } as unknown as GoogleGenAI;
    const gateway = createGeminiTranscriptionGateway(ai);

    await gateway.repair(
      'https://files.example/audio',
      'audio/wav',
      'A baseline transcript',
      { likelyLanguages: ['English'], preserveCodeSwitching: true },
    );

    const request = create.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      input: [
        { type: 'text' },
        { type: 'audio', uri: 'https://files.example/audio', mime_type: 'audio/wav' },
      ],
    });
    expect(request.input[0].text).toContain('A baseline transcript');
    expect(request.input[0].text).not.toContain('C2 transcript');
  });
});

describe('processSessionWavFile', () => {
  it('runs product processing as A followed by D2 and preserves both layers', async () => {
    const gateway: GeminiTranscriptionGateway = {
      upload: vi.fn().mockResolvedValue({ name: 'files/session', uri: 'https://files.example/session', mimeType: 'audio/wav' }),
      transcribe: vi.fn().mockResolvedValue('Raw A transcript.'),
      understand: vi.fn(),
      repair: vi.fn().mockResolvedValue('Repaired D2 transcript.'),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(processSessionWavFile(gateway, 'temporary.wav')).resolves.toEqual({
      rawFinalTranscript: 'Raw A transcript.',
      repairedTranscript: 'Repaired D2 transcript.',
      error: null,
    });
    expect(gateway.transcribe).toHaveBeenCalledTimes(1);
    expect(gateway.repair).toHaveBeenCalledWith(
      'https://files.example/session',
      'audio/wav',
      'Raw A transcript.',
      undefined,
    );
    expect(gateway.delete).toHaveBeenCalledWith('files/session');
  });

  it('keeps A when repair fails and does not make processing failure erase it', async () => {
    const gateway: GeminiTranscriptionGateway = {
      upload: vi.fn().mockResolvedValue({ name: 'files/session', uri: 'https://files.example/session' }),
      transcribe: vi.fn().mockResolvedValue('Raw A transcript.'),
      understand: vi.fn(),
      repair: vi.fn().mockRejectedValue(new Error('repair unavailable')),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(processSessionWavFile(gateway, 'temporary.wav')).resolves.toEqual({
      rawFinalTranscript: 'Raw A transcript.',
      repairedTranscript: null,
      error: 'Audio-grounded transcript repair failed.',
    });
  });

  it('does not attempt D2 when A fails, while cleaning the temporary upload', async () => {
    const gateway: GeminiTranscriptionGateway = {
      upload: vi.fn().mockResolvedValue({ name: 'files/session', uri: 'https://files.example/session' }),
      transcribe: vi.fn().mockRejectedValue(new Error('transcription unavailable')),
      understand: vi.fn(),
      repair: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(processSessionWavFile(gateway, 'temporary.wav')).resolves.toEqual({
      rawFinalTranscript: null,
      repairedTranscript: null,
      error: 'Gemini transcription failed.',
    });
    expect(gateway.repair).not.toHaveBeenCalled();
    expect(gateway.delete).toHaveBeenCalledWith('files/session');
  });

  it('does not expose the gateway or credentials in its product result', async () => {
    const gateway: GeminiTranscriptionGateway = {
      upload: vi.fn().mockRejectedValue(new Error('api_key=secret-value')),
      transcribe: vi.fn(),
      understand: vi.fn(),
      repair: vi.fn(),
      delete: vi.fn(),
    };

    await expect(processSessionWavFile(gateway, 'temporary.wav')).rejects.toMatchObject({
      code: 'GEMINI_UPLOAD_FAILED',
      message: 'Gemini Files upload failed.',
    });
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  createGeminiTranscriptionGateway,
  RefinementServiceError,
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

  it('uploads, transcribes, and deletes the temporary Gemini file', async () => {
    const gateway: GeminiTranscriptionGateway = {
      upload: vi.fn().mockResolvedValue({ name: 'files/temporary', uri: 'https://files.example/audio', mimeType: 'audio/wav' }),
      transcribe: vi.fn().mockResolvedValue('Refined transcript.'),
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
      delete: vi.fn(),
    };

    await expect(transcribeWavFile(gateway, 'temporary.wav')).rejects.toMatchObject({
      code: 'GEMINI_UPLOAD_FAILED',
      message: 'Gemini Files upload failed.',
    });
    expect(gateway.transcribe).not.toHaveBeenCalled();
  });
});

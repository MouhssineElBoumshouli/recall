export interface WavMetadata {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
  durationMs: number;
}

export interface WavValidationResult {
  valid: boolean;
  error: string | null;
  metadata: WavMetadata | null;
}

export const MAX_TRANSCRIPTION_BYTES = 50 * 1024 * 1024;

export const WAV_TRANSPORT_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'application/octet-stream',
]);

export type WavRequestErrorCode = 'MISSING_AUDIO' | 'INVALID_WAV' | 'UNSUPPORTED_TRANSPORT_MIME';

export interface WavRequestValidationResult {
  valid: boolean;
  statusCode: 200 | 400 | 415;
  code: WavRequestErrorCode | null;
  error: string | null;
  contentType: string | null;
  metadata: WavMetadata | null;
}

function ascii(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString('ascii');
}

export function normalizeContentType(value: string | undefined): string | null {
  const normalized = value?.split(';', 1)[0].trim().toLowerCase();
  return normalized || null;
}

export function isWithinTranscriptionLimit(byteLength: number): boolean {
  return Number.isSafeInteger(byteLength) && byteLength >= 0 && byteLength <= MAX_TRANSCRIPTION_BYTES;
}

export function validateWavBuffer(buffer: Buffer | null | undefined): WavValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Audio body is missing.', metadata: null };
  }

  if (buffer.length < 44) {
    return { valid: false, error: 'Audio is too short to be a WAV file.', metadata: null };
  }

  if (ascii(buffer, 0, 4) !== 'RIFF' || ascii(buffer, 8, 4) !== 'WAVE') {
    return { valid: false, error: 'Audio must be a RIFF/WAVE file.', metadata: null };
  }

  const riffSize = buffer.readUInt32LE(4);
  if (riffSize + 8 > buffer.length) {
    return { valid: false, error: 'WAV file is truncated.', metadata: null };
  }

  let format: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let dataBytes = 0;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = ascii(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    if (chunkEnd > buffer.length) {
      return { valid: false, error: 'WAV chunk is truncated.', metadata: null };
    }

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      dataBytes = chunkSize;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!format) {
    return { valid: false, error: 'WAV format metadata is missing.', metadata: null };
  }

  if (format.audioFormat !== 1) {
    return { valid: false, error: 'WAV audio must use uncompressed PCM.', metadata: null };
  }

  if (format.channels !== 1 || format.bitsPerSample !== 16) {
    return { valid: false, error: 'WAV audio must be mono PCM16.', metadata: null };
  }

  if (format.sampleRate <= 0 || dataBytes === 0) {
    return { valid: false, error: 'WAV audio contains no samples.', metadata: null };
  }

  const blockAlign = format.channels * (format.bitsPerSample / 8);
  return {
    valid: true,
    error: null,
    metadata: {
      ...format,
      dataBytes,
      durationMs: (dataBytes / blockAlign / format.sampleRate) * 1_000,
    },
  };
}

export function validateWavRequest(
  contentType: string | undefined,
  buffer: Buffer | null | undefined,
): WavRequestValidationResult {
  const normalizedContentType = normalizeContentType(contentType);
  const validation = validateWavBuffer(buffer);

  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      statusCode: 400,
      code: 'MISSING_AUDIO',
      error: 'Audio body is missing.',
      contentType: normalizedContentType,
      metadata: null,
    };
  }

  if (validation.valid) {
    return {
      valid: true,
      statusCode: 200,
      code: null,
      error: null,
      contentType: normalizedContentType,
      metadata: validation.metadata,
    };
  }

  if (normalizedContentType && !WAV_TRANSPORT_MIME_TYPES.has(normalizedContentType)) {
    return {
      valid: false,
      statusCode: 415,
      code: 'UNSUPPORTED_TRANSPORT_MIME',
      error: 'Unsupported audio transport type.',
      contentType: normalizedContentType,
      metadata: null,
    };
  }

  return {
    valid: false,
    statusCode: 400,
    code: 'INVALID_WAV',
    error: validation.error || 'Invalid WAV audio.',
    contentType: normalizedContentType,
    metadata: null,
  };
}

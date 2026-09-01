import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  CHIRP3_LANGUAGE,
  CHIRP3_MODEL,
  createChirp3TranscriptionGateway,
} from '../server/chirp3TranscriptionService';

describe('Chirp 3 transcription adapter', () => {
  it('uses Speech-to-Text V2 Recognize with chirp_3 and ar-MA', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'recall-chirp-test-'));
    const filePath = join(directory, 'recording.wav');
    await writeFile(filePath, Buffer.from('wav bytes'));
    const recognize = vi.fn().mockResolvedValue([
      {
        results: [
          { alternatives: [{ transcript: 'النص المغربي' }] },
          { alternatives: [{ transcript: 'with French' }] },
        ],
      },
    ]);

    try {
      const gateway = createChirp3TranscriptionGateway({
        projectId: 'project-for-test',
        location: 'us',
        client: { recognize },
      });

      await expect(gateway.transcribe(filePath)).resolves.toBe('النص المغربي\nwith French');
      expect(recognize).toHaveBeenCalledWith({
        recognizer: 'projects/project-for-test/locations/us/recognizers/_',
        config: {
          autoDecodingConfig: {},
          languageCodes: [CHIRP3_LANGUAGE],
          model: CHIRP3_MODEL,
        },
        content: Buffer.from('wav bytes'),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

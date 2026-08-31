import { describe, expect, it } from 'vitest';

import { TranscriptAccumulator } from '@/services/transcriptAccumulator';

const baseInput = {
  sessionGeneration: 1,
  connectionId: 'connection-1',
};

describe('TranscriptAccumulator', () => {
  it('keeps interim text separate and replaces it with a finalized segment', () => {
    const accumulator = new TranscriptAccumulator();

    accumulator.setInterim({
      ...baseInput,
      kind: 'interim',
      text: 'bonjour le',
      relativeTimestampMs: 1_000,
    });
    expect(accumulator.snapshot().interim?.text).toBe('bonjour le');
    expect(accumulator.snapshot().finalizedSegments).toHaveLength(0);

    accumulator.appendFinal({
      ...baseInput,
      kind: 'final',
      text: '  Bonjour   le monde. ',
      relativeTimestampMs: 1_500,
    });
    const snapshot = accumulator.snapshot();
    expect(snapshot.interim).toBeNull();
    expect(snapshot.finalizedSegments).toHaveLength(1);
    expect(snapshot.finalizedSegments[0]).toMatchObject({
      text: 'Bonjour le monde.',
      finalized: true,
      relativeTimestampMs: 1_500,
      sessionGeneration: 1,
    });
  });

  it('ignores duplicate finalized events without dropping later repeated speech', () => {
    const accumulator = new TranscriptAccumulator();
    const input = {
      ...baseInput,
      kind: 'final' as const,
      text: 'same phrase',
      relativeTimestampMs: 2_000,
    };

    expect(accumulator.appendFinal(input)).not.toBeNull();
    expect(accumulator.appendFinal({ ...input, relativeTimestampMs: 2_100 })).toBeNull();
    expect(accumulator.appendFinal({ ...input, relativeTimestampMs: 5_000 })).not.toBeNull();
    expect(accumulator.snapshot().finalizedSegments).toHaveLength(2);
  });

  it('uses a source id as a stable duplicate key when Gemini provides one', () => {
    const accumulator = new TranscriptAccumulator();
    const input = {
      ...baseInput,
      kind: 'final' as const,
      text: 'one authoritative line',
      relativeTimestampMs: 2_000,
      sourceId: 'event-42',
    };

    accumulator.appendFinal(input);
    expect(accumulator.appendFinal({ ...input, relativeTimestampMs: 40_000 })).toBeNull();
  });
});

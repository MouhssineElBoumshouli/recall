import { describe, expect, it } from 'vitest';

import {
  buildTranscriptUpdate,
  getPreferredTranscript,
  resolvePreferredTranscript,
} from '@/services/transcriptPreference';

const layers = {
  repairedTranscript: 'D2',
  rawFinalTranscript: 'A',
  liveTranscript: 'Live',
};

describe('preferred transcript selection', () => {
  it('uses the current default preference order without claiming ground truth', () => {
    expect(resolvePreferredTranscript(layers)).toEqual({ text: 'D2', source: 'repaired' });
    expect(resolvePreferredTranscript({ ...layers, repairedTranscript: null })).toEqual({ text: 'A', source: 'raw-final' });
    expect(resolvePreferredTranscript({ ...layers, repairedTranscript: '', rawFinalTranscript: null })).toEqual({ text: 'Live', source: 'live-finalized' });
    expect(resolvePreferredTranscript({ ...layers, repairedTranscript: null, rawFinalTranscript: null, liveTranscript: ' ' })).toEqual({ text: '', source: 'none' });
  });

  it('supports a future source override while retaining the default fallback', () => {
    expect(resolvePreferredTranscript(layers, 'raw-final')).toEqual({ text: 'A', source: 'raw-final' });
    expect(resolvePreferredTranscript({ ...layers, rawFinalTranscript: null }, 'raw-final')).toEqual({ text: 'D2', source: 'repaired' });
  });

  it('provides the stable downstream accessor over preserved transcript layers', () => {
    expect(getPreferredTranscript({ ...layers, preferredTranscriptSourceOverride: 'live-finalized' })).toEqual({ text: 'Live', source: 'live-finalized' });
  });

  it('recomputes the preferred projection while leaving lower-level layers available to the caller', () => {
    const update = buildTranscriptUpdate(
      {
        ...layers,
        preferredTranscriptSourceOverride: null,
      },
      { repairedTranscript: 'D2 updated', transcriptStatus: 'succeeded' },
    );

    expect(update).toMatchObject({
      repairedTranscript: 'D2 updated',
      preferredTranscript: 'D2 updated',
      preferredTranscriptSource: 'repaired',
    });
    expect(resolvePreferredTranscript({
      liveTranscript: 'Live',
      rawFinalTranscript: 'A',
      repairedTranscript: update.repairedTranscript ?? null,
    })).toEqual({ text: 'D2 updated', source: 'repaired' });
  });
});

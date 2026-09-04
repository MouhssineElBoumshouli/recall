import { describe, expect, it } from 'vitest';

import { buildTranscriptUpdate, selectAuthoritativeTranscript } from '@/services/transcriptAuthority';

describe('authoritative transcript selection', () => {
  it('prefers repaired, then raw final, then live finalized transcript', () => {
    expect(selectAuthoritativeTranscript({ repairedTranscript: 'D2', rawFinalTranscript: 'A', liveTranscript: 'Live' })).toEqual({ text: 'D2', source: 'repaired' });
    expect(selectAuthoritativeTranscript({ repairedTranscript: null, rawFinalTranscript: 'A', liveTranscript: 'Live' })).toEqual({ text: 'A', source: 'raw-final' });
    expect(selectAuthoritativeTranscript({ repairedTranscript: '', rawFinalTranscript: null, liveTranscript: 'Live' })).toEqual({ text: 'Live', source: 'live-finalized' });
    expect(selectAuthoritativeTranscript({ repairedTranscript: null, rawFinalTranscript: null, liveTranscript: ' ' })).toEqual({ text: '', source: 'none' });
  });

  it('recomputes the authoritative layer without discarding lower-level layers', () => {
    const update = buildTranscriptUpdate(
      { liveTranscript: 'Live', rawFinalTranscript: 'A', repairedTranscript: null },
      { repairedTranscript: 'D2', transcriptStatus: 'succeeded' },
    );

    expect(update).toMatchObject({
      repairedTranscript: 'D2',
      text: 'D2',
      source: 'repaired',
      transcriptStatus: 'succeeded',
    });
  });
});


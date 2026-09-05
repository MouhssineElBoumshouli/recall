import { describe, expect, it } from 'vitest';

import { createNewSession } from '@/services/sessionFactory';
import { isSessionIntelligenceStale } from '@/services/sessionIntelligenceState';
import { createEmptySessionIntelligence } from '@/types/intelligence';

function session() {
  return createNewSession({
    id: 'stale-test',
    recordedAt: '2026-09-05T10:00:00.000Z',
    durationMs: 1_000,
    audioUri: 'file:///sessions/stale-test/audio.wav',
    finalizedSegments: [],
    bookmarks: [],
  }).session;
}

describe('session intelligence staleness', () => {
  it('marks succeeded intelligence stale when the preferred transcript changes', () => {
    const savedSession = session();
    savedSession.rawFinalTranscript = 'Original transcript.';
    const intelligence = {
      ...createEmptySessionIntelligence(savedSession.id),
      status: 'succeeded' as const,
      sourceTranscriptFingerprint: 'fnv1a-old',
      sourceTranscriptSource: 'raw-final' as const,
    };

    expect(isSessionIntelligenceStale(savedSession, intelligence)).toBe(true);
  });

  it('does not mark processing or failed intelligence stale', () => {
    const savedSession = session();
    const intelligence = createEmptySessionIntelligence(savedSession.id);

    expect(isSessionIntelligenceStale(savedSession, intelligence)).toBe(false);
    expect(isSessionIntelligenceStale(savedSession, { ...intelligence, status: 'failed' })).toBe(false);
  });
});

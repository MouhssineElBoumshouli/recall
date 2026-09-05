import { describe, expect, it, vi } from 'vitest';

import { createNewSession } from '@/services/sessionFactory';
import { createSessionIntelligenceRunGate, runSessionIntelligence } from '@/services/sessionIntelligenceWorkflow';
import { createEmptySessionIntelligence, type SessionIntelligence } from '@/types/intelligence';
import type { SessionRepository } from '@/services/sessionRepository';

const content = {
  summary: 'A grounded summary.',
  keyPoints: ['A key point.'],
  actionItems: [{ text: 'Follow up.', owner: null, dueDate: null }],
  chapters: [{ title: 'Topic one', summary: 'The first topic.', startTimestampMs: null }],
};

function createFixture() {
  const created = createNewSession({
    id: 'session-intelligence-test',
    recordedAt: '2026-09-05T10:00:00.000Z',
    durationMs: 12_000,
    audioUri: 'file:///sessions/intelligence/audio.wav',
    finalizedSegments: [],
    bookmarks: [],
  });
  created.session.liveTranscript = 'Live transcript.';
  created.session.rawFinalTranscript = 'Raw final transcript.';
  created.session.repairedTranscript = 'Preferred repaired transcript.';
  let intelligence = createEmptySessionIntelligence(created.session.id);

  const repository: SessionRepository = {
    initialize: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([created.session]),
    getSession: vi.fn().mockImplementation(async () => ({
      session: created.session,
      bookmarks: created.bookmarks,
      intelligence,
    })),
    getIntelligence: vi.fn().mockImplementation(async () => intelligence),
    updateIntelligence: vi.fn().mockImplementation(async (_id, update) => {
      intelligence = { ...intelligence, ...update } as SessionIntelligence;
    }),
    createSession: vi.fn().mockResolvedValue(undefined),
    updateSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  };

  return { created, repository, getIntelligence: () => intelligence };
}

describe('session intelligence workflow', () => {
  it('does not call the provider when the preferred transcript is empty', async () => {
    const fixture = createFixture();
    fixture.created.session.liveTranscript = '';
    fixture.created.session.rawFinalTranscript = null;
    fixture.created.session.repairedTranscript = null;
    const generator = { generate: vi.fn() };

    await runSessionIntelligence(fixture.created.session.id, fixture.repository, generator);

    expect(generator.generate).not.toHaveBeenCalled();
    expect(fixture.getIntelligence()).toMatchObject({ status: 'not-started', sourceTranscriptSource: 'none' });
  });

  it('passes only the centralized preferred transcript to the provider and persists structured output', async () => {
    const fixture = createFixture();
    const generator = { generate: vi.fn().mockResolvedValue(content) };

    await runSessionIntelligence(fixture.created.session.id, fixture.repository, generator, () => '2026-09-05T10:01:00.000Z');

    expect(generator.generate).toHaveBeenCalledWith(expect.objectContaining({
      preferredTranscript: 'Preferred repaired transcript.',
      languageContext: null,
    }));
    expect(fixture.getIntelligence()).toMatchObject({
      status: 'succeeded',
      generatedAt: '2026-09-05T10:01:00.000Z',
      sourceTranscriptSource: 'repaired',
      summary: 'A grounded summary.',
      keyPoints: ['A key point.'],
      actionItems: [{ id: 'session-intelligence-test-action-1', text: 'Follow up.' }],
      chapters: [{ id: 'session-intelligence-test-chapter-1', title: 'Topic one' }],
    });
  });

  it('keeps the session and transcript intact when intelligence generation fails', async () => {
    const fixture = createFixture();
    const generator = { generate: vi.fn().mockRejectedValue(new Error('provider unavailable')) };

    await runSessionIntelligence(fixture.created.session.id, fixture.repository, generator);

    expect(fixture.created.session.audioUri).toContain('audio.wav');
    expect(fixture.created.session.repairedTranscript).toBe('Preferred repaired transcript.');
    expect(fixture.getIntelligence()).toMatchObject({ status: 'failed', processingError: 'Notes could not be generated.' });
  });

  it('supports failed then successful retry without duplicate stored results', async () => {
    const fixture = createFixture();
    const generator = { generate: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(content) };

    await runSessionIntelligence(fixture.created.session.id, fixture.repository, generator);
    expect(fixture.getIntelligence().status).toBe('failed');
    await runSessionIntelligence(fixture.created.session.id, fixture.repository, generator);

    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(fixture.repository.updateIntelligence).toHaveBeenCalledTimes(4);
    expect(fixture.getIntelligence().status).toBe('succeeded');
    expect(fixture.getIntelligence().actionItems).toHaveLength(1);
  });

  it('prevents duplicate in-flight requests for the same session', async () => {
    const gate = createSessionIntelligenceRunGate();
    let release: (() => void) | undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));

    const first = gate.run('session-1', task);
    const second = gate.run('session-1', task);
    expect(task).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });
});

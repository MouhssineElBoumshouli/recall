import { describe, expect, it } from 'vitest';

import { createNewSession } from '@/services/sessionFactory';
import {
  createSessionRepository,
  initializeSessionSchema,
  type SessionDatabase,
  type SqliteValue,
} from '@/services/sessionRepository';
import type { RecallSession } from '@/types/session';
import type { SessionIntelligence } from '@/types/intelligence';

interface StoredSessionRow {
  id: string;
  title: string;
  created_at: string;
  recorded_at: string;
  updated_at: string;
  duration_ms: number;
  audio_uri: string;
  recording_status: RecallSession['recordingStatus'];
  transcript_status: RecallSession['transcriptStatus'];
  live_transcript: string;
  raw_final_transcript: string | null;
  repaired_transcript: string | null;
  preferred_transcript: string;
  preferred_source: RecallSession['preferredTranscriptSource'];
  preferred_source_override: RecallSession['preferredTranscriptSourceOverride'];
  language_context: string | null;
  processing_error: string | null;
}

interface StoredBookmarkRow {
  id: string;
  session_id: string;
  timestamp_ms: number;
  created_at: string;
}

interface StoredIntelligenceRow {
  session_id: string;
  status: SessionIntelligence['status'];
  generated_at: string | null;
  source_transcript_fingerprint: string | null;
  source_transcript_source: SessionIntelligence['sourceTranscriptSource'];
  summary: string;
  key_points: string;
  action_items: string;
  chapters: string;
  processing_error: string | null;
}

class FakeDatabase implements SessionDatabase {
  version: number;
  schemaExecutions = 0;
  migrationSql = '';
  sessions = new Map<string, StoredSessionRow>();
  bookmarks: StoredBookmarkRow[] = [];
  intelligence = new Map<string, StoredIntelligenceRow>();

  constructor(version = 0) {
    this.version = version;
  }

  async execAsync(source: string): Promise<void> {
    if (source.includes('CREATE TABLE IF NOT EXISTS sessions')) {
      this.schemaExecutions += 1;
    }
    if (source.includes('PRAGMA user_version = 2')) {
      this.version = 2;
    }
    if (source.includes('PRAGMA user_version = 3')) {
      this.version = 3;
    }
    if (source.includes('ALTER TABLE sessions RENAME COLUMN')) {
      this.migrationSql = source;
    }
  }

  async runAsync(source: string, params: SqliteValue[] = []): Promise<unknown> {
    if (source.includes('INSERT INTO sessions')) {
      const [id, title, createdAt, recordedAt, updatedAt, durationMs, audioUri, recordingStatus, transcriptStatus, liveTranscript, rawFinal, repaired, preferred, preferredSource, preferredSourceOverride, languageContext, processingError] = params;
      this.sessions.set(String(id), {
        id: String(id), title: String(title), created_at: String(createdAt), recorded_at: String(recordedAt), updated_at: String(updatedAt),
        duration_ms: Number(durationMs), audio_uri: String(audioUri), recording_status: recordingStatus as RecallSession['recordingStatus'],
        transcript_status: transcriptStatus as RecallSession['transcriptStatus'], live_transcript: String(liveTranscript),
        raw_final_transcript: rawFinal as string | null, repaired_transcript: repaired as string | null,
        preferred_transcript: String(preferred), preferred_source: preferredSource as RecallSession['preferredTranscriptSource'], preferred_source_override: preferredSourceOverride as RecallSession['preferredTranscriptSourceOverride'],
        language_context: languageContext as string | null, processing_error: processingError as string | null,
      });
    } else if (source.includes('INSERT INTO session_intelligence')) {
      const [sessionId, status, generatedAt, fingerprint, sourceName, summary, keyPoints, actionItems, chapters, processingError] = params;
      this.intelligence.set(String(sessionId), {
        session_id: String(sessionId),
        status: status as SessionIntelligence['status'],
        generated_at: generatedAt as string | null,
        source_transcript_fingerprint: fingerprint as string | null,
        source_transcript_source: sourceName as SessionIntelligence['sourceTranscriptSource'],
        summary: String(summary),
        key_points: String(keyPoints),
        action_items: String(actionItems),
        chapters: String(chapters),
        processing_error: processingError as string | null,
      });
    } else if (source.includes('INSERT INTO bookmarks')) {
      const [id, sessionId, timestampMs, createdAt] = params;
      this.bookmarks.push({ id: String(id), session_id: String(sessionId), timestamp_ms: Number(timestampMs), created_at: String(createdAt) });
    } else if (source.startsWith('UPDATE sessions SET title')) {
      const [title, updatedAt, id] = params;
      const current = this.sessions.get(String(id));
      if (current) {
        this.sessions.set(String(id), { ...current, title: String(title), updated_at: String(updatedAt) });
      }
    } else if (source.startsWith('UPDATE sessions SET')) {
      const [updatedAt, live, rawFinal, repaired, preferred, preferredSource, preferredSourceOverride, transcriptStatus, processingError, id] = params;
      const current = this.sessions.get(String(id));
      if (current) {
        this.sessions.set(String(id), {
          ...current,
          updated_at: String(updatedAt),
          live_transcript: String(live),
          raw_final_transcript: rawFinal as string | null,
          repaired_transcript: repaired as string | null,
          preferred_transcript: String(preferred),
          preferred_source: preferredSource as RecallSession['preferredTranscriptSource'],
          preferred_source_override: preferredSourceOverride as RecallSession['preferredTranscriptSourceOverride'],
          transcript_status: (transcriptStatus === null ? current.transcript_status : transcriptStatus) as RecallSession['transcriptStatus'],
          processing_error: processingError as string | null,
        });
      }
    } else if (source.startsWith('DELETE FROM sessions')) {
      const [id] = params;
      this.sessions.delete(String(id));
      this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.session_id !== String(id));
      this.intelligence.delete(String(id));
    }
    return {};
  }

  async getFirstAsync<T>(source: string, params: SqliteValue[] = []): Promise<T | null> {
    if (source.includes('PRAGMA user_version')) {
      return { user_version: this.version } as T;
    }
    if (source.includes('FROM session_intelligence')) {
      return (this.intelligence.get(String(params[0])) || null) as T | null;
    }
    const row = this.sessions.get(String(params[0]));
    return (row || null) as T | null;
  }

  async getAllAsync<T>(source: string, params: SqliteValue[] = []): Promise<T[]> {
    if (source.includes('FROM bookmarks')) {
      return this.bookmarks
        .filter((bookmark) => bookmark.session_id === String(params[0]))
        .sort((a, b) => a.timestamp_ms - b.timestamp_ms) as T[];
    }
    return [...this.sessions.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at)) as T[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await task();
  }
}

function session(id: string, recordedAt: string) {
  return createNewSession({
    id,
    recordedAt,
    durationMs: 10_000,
    audioUri: `file:///sessions/${id}/audio.wav`,
    finalizedSegments: [],
    bookmarks: [{ id: `${id}-bookmark`, elapsedTimestampMs: 2_000, createdAt: recordedAt }],
  });
}

function storedRow(value: RecallSession): StoredSessionRow {
  return {
    id: value.id,
    title: value.title,
    created_at: value.createdAt,
    recorded_at: value.recordedAt,
    updated_at: value.updatedAt,
    duration_ms: value.durationMs,
    audio_uri: value.audioUri,
    recording_status: value.recordingStatus,
    transcript_status: value.transcriptStatus,
    live_transcript: value.liveTranscript,
    raw_final_transcript: value.rawFinalTranscript,
    repaired_transcript: value.repairedTranscript,
    preferred_transcript: value.preferredTranscript,
    preferred_source: value.preferredTranscriptSource,
    preferred_source_override: value.preferredTranscriptSourceOverride,
    language_context: value.languageContext ? JSON.stringify(value.languageContext) : null,
    processing_error: value.processingError,
  };
}

describe('persistent session repository', () => {
  it('initializes schema once, persists sessions/bookmarks, sorts newest first, and reloads', async () => {
    const database = new FakeDatabase();
    const repository = createSessionRepository(database);
    const older = session('older', '2026-09-03T10:00:00.000Z');
    const newer = session('newer', '2026-09-04T10:00:00.000Z');

    await initializeSessionSchema(database);
    await repository.initialize();
    expect(database.schemaExecutions).toBe(1);
    expect(database.version).toBe(3);

    await repository.createSession(older.session, older.bookmarks);
    await repository.createSession(newer.session, newer.bookmarks);
    expect((await repository.listSessions()).map((item) => item.id)).toEqual(['newer', 'older']);
    expect((await repository.getSession('newer'))?.bookmarks).toHaveLength(1);
    expect((await repository.getSession('newer'))?.intelligence).toMatchObject({
      sessionId: 'newer',
      status: 'not-started',
      sourceTranscriptSource: 'none',
    });

    await repository.updateIntelligence('newer', {
      status: 'succeeded',
      generatedAt: '2026-09-04T10:01:00.000Z',
      sourceTranscriptFingerprint: 'fnv1a-test',
      sourceTranscriptSource: 'live-finalized',
      summary: 'Saved summary.',
      keyPoints: ['Saved point.'],
      actionItems: [],
      chapters: [],
    });

    const restartedRepository = createSessionRepository(database);
    expect((await restartedRepository.listSessions()).map((item) => item.id)).toEqual(['newer', 'older']);
    expect((await restartedRepository.getSession('newer'))?.intelligence).toMatchObject({
      status: 'succeeded',
      generatedAt: '2026-09-04T10:01:00.000Z',
      summary: 'Saved summary.',
      keyPoints: ['Saved point.'],
    });
  });

  it('migrates the v1 transcript projection names without changing saved semantics', async () => {
    const database = new FakeDatabase(1);
    const legacy = session('legacy', '2026-09-04T09:00:00.000Z');
    legacy.session.rawFinalTranscript = 'Raw final';
    legacy.session.repairedTranscript = 'Repaired';
    legacy.session.preferredTranscript = 'Repaired';
    legacy.session.preferredTranscriptSource = 'repaired';
    database.sessions.set(legacy.session.id, storedRow(legacy.session));

    const repository = createSessionRepository(database);
    await repository.initialize();

    expect(database.version).toBe(3);
    expect(database.migrationSql).toContain('authoritative_transcript TO preferred_transcript');
    expect(database.migrationSql).toContain('authoritative_source TO preferred_source');
    expect((await repository.getSession('legacy'))?.session).toMatchObject({
      id: 'legacy',
      rawFinalTranscript: 'Raw final',
      repairedTranscript: 'Repaired',
      preferredTranscript: 'Repaired',
      preferredTranscriptSource: 'repaired',
      preferredTranscriptSourceOverride: null,
    });
  });

  it('renames, updates transcript layers, and deletes only the requested session with bookmarks', async () => {
    const database = new FakeDatabase();
    const repository = createSessionRepository(database);
    const first = session('first', '2026-09-04T10:00:00.000Z');
    const second = session('second', '2026-09-04T11:00:00.000Z');
    await repository.createSession(first.session, first.bookmarks);
    await repository.createSession(second.session, second.bookmarks);

    await repository.renameSession('first', 'Renamed session');
    await repository.updateSession('first', {
      rawFinalTranscript: 'A transcript',
      repairedTranscript: 'D2 transcript',
      preferredTranscriptSourceOverride: 'raw-final',
      transcriptStatus: 'succeeded',
    });
    expect((await repository.getSession('first'))?.session).toMatchObject({
      title: 'Renamed session',
      rawFinalTranscript: 'A transcript',
      repairedTranscript: 'D2 transcript',
      preferredTranscript: 'A transcript',
      preferredTranscriptSource: 'raw-final',
      preferredTranscriptSourceOverride: 'raw-final',
    });

    const restartedRepository = createSessionRepository(database);
    expect((await restartedRepository.getSession('first'))?.session).toMatchObject({
      preferredTranscript: 'A transcript',
      preferredTranscriptSource: 'raw-final',
      preferredTranscriptSourceOverride: 'raw-final',
    });

    await repository.deleteSession('first');
    expect(await repository.getSession('first')).toBeNull();
    expect(database.intelligence.has('first')).toBe(false);
    expect((await repository.getSession('second'))?.bookmarks).toHaveLength(1);
  });

  it('allows a saved session to remain when processing later fails', async () => {
    const database = new FakeDatabase();
    const repository = createSessionRepository(database);
    const saved = session('saved', '2026-09-04T12:00:00.000Z');
    await repository.createSession(saved.session, saved.bookmarks);
    await repository.updateSession('saved', {
      transcriptStatus: 'failed',
      processingError: 'Remote processing unavailable.',
    });

    expect((await repository.getSession('saved'))?.session).toMatchObject({
      recordingStatus: 'complete',
      transcriptStatus: 'failed',
      processingError: 'Remote processing unavailable.',
    });
  });
});

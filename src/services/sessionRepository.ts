import type { SQLiteBindValue } from 'expo-sqlite';

import type {
  RecallSession,
  RecallSessionWithBookmarks,
  SessionBookmark,
  SessionTranscriptUpdate,
} from '@/types/session';
import {
  createEmptySessionIntelligence,
  type SessionIntelligence,
  type SessionIntelligenceUpdate,
} from '@/types/intelligence';
import { buildTranscriptUpdate } from '@/services/transcriptPreference';

export type SqliteValue = SQLiteBindValue;

export interface SessionDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params?: SqliteValue[]): Promise<unknown>;
  getFirstAsync<T>(source: string, params?: SqliteValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, params?: SqliteValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export const SESSION_DATABASE_VERSION = 3;

export const SESSION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  audio_uri TEXT NOT NULL,
  recording_status TEXT NOT NULL,
  transcript_status TEXT NOT NULL,
  live_transcript TEXT NOT NULL DEFAULT '',
  raw_final_transcript TEXT,
  repaired_transcript TEXT,
  preferred_transcript TEXT NOT NULL DEFAULT '',
  preferred_source TEXT NOT NULL DEFAULT 'none',
  preferred_source_override TEXT,
  language_context TEXT,
  processing_error TEXT
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_session_id ON bookmarks(session_id);
CREATE TABLE IF NOT EXISTS session_intelligence (
  session_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'not-started',
  generated_at TEXT,
  source_transcript_fingerprint TEXT,
  source_transcript_source TEXT NOT NULL DEFAULT 'none',
  summary TEXT NOT NULL DEFAULT '',
  key_points TEXT NOT NULL DEFAULT '[]',
  action_items TEXT NOT NULL DEFAULT '[]',
  chapters TEXT NOT NULL DEFAULT '[]',
  processing_error TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_intelligence_status ON session_intelligence(status);
`;

export const SESSION_SCHEMA_V1_TO_V2_SQL = `
ALTER TABLE sessions RENAME COLUMN authoritative_transcript TO preferred_transcript;
ALTER TABLE sessions RENAME COLUMN authoritative_source TO preferred_source;
ALTER TABLE sessions ADD COLUMN preferred_source_override TEXT;
PRAGMA user_version = 2;
`;

export const SESSION_SCHEMA_V2_TO_V3_SQL = `
CREATE TABLE IF NOT EXISTS session_intelligence (
  session_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'not-started',
  generated_at TEXT,
  source_transcript_fingerprint TEXT,
  source_transcript_source TEXT NOT NULL DEFAULT 'none',
  summary TEXT NOT NULL DEFAULT '',
  key_points TEXT NOT NULL DEFAULT '[]',
  action_items TEXT NOT NULL DEFAULT '[]',
  chapters TEXT NOT NULL DEFAULT '[]',
  processing_error TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO session_intelligence (session_id) SELECT id FROM sessions;
CREATE INDEX IF NOT EXISTS idx_session_intelligence_status ON session_intelligence(status);
PRAGMA user_version = 3;
`;

interface SessionRow {
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

interface BookmarkRow {
  id: string;
  session_id: string;
  timestamp_ms: number;
  created_at: string;
}

interface SessionIntelligenceRow {
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

function parseLanguageContext(value: string | null): RecallSession['languageContext'] {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as RecallSession['languageContext'] : null;
  } catch {
    return null;
  }
}

function mapSession(row: SessionRow): RecallSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
    durationMs: row.duration_ms,
    audioUri: row.audio_uri,
    recordingStatus: row.recording_status,
    transcriptStatus: row.transcript_status,
    liveTranscript: row.live_transcript,
    rawFinalTranscript: row.raw_final_transcript,
    repairedTranscript: row.repaired_transcript,
    preferredTranscript: row.preferred_transcript,
    preferredTranscriptSource: row.preferred_source,
    preferredTranscriptSourceOverride: row.preferred_source_override,
    languageContext: parseLanguageContext(row.language_context),
    processingError: row.processing_error,
  };
}

function mapBookmark(row: BookmarkRow): SessionBookmark {
  return {
    id: row.id,
    sessionId: row.session_id,
    elapsedTimestampMs: row.timestamp_ms,
    createdAt: row.created_at,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseActionItems(value: string): SessionIntelligence['actionItems'] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is SessionIntelligence['actionItems'][number] => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return typeof candidate.id === 'string' && typeof candidate.text === 'string' &&
        (typeof candidate.owner === 'string' || candidate.owner === null) &&
        (typeof candidate.dueDate === 'string' || candidate.dueDate === null);
    });
  } catch {
    return [];
  }
}

function parseChapters(value: string): SessionIntelligence['chapters'] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is SessionIntelligence['chapters'][number] => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return typeof candidate.id === 'string' && typeof candidate.title === 'string' &&
        typeof candidate.summary === 'string' &&
        (typeof candidate.startTimestampMs === 'number' || candidate.startTimestampMs === null);
    });
  } catch {
    return [];
  }
}

function mapIntelligence(row: SessionIntelligenceRow): SessionIntelligence {
  return {
    sessionId: row.session_id,
    status: row.status,
    generatedAt: row.generated_at,
    sourceTranscriptFingerprint: row.source_transcript_fingerprint,
    sourceTranscriptSource: row.source_transcript_source,
    summary: row.summary,
    keyPoints: parseStringArray(row.key_points),
    actionItems: parseActionItems(row.action_items),
    chapters: parseChapters(row.chapters),
    processingError: row.processing_error,
  };
}

function intelligenceParams(intelligence: SessionIntelligence): SqliteValue[] {
  return [
    intelligence.sessionId,
    intelligence.status,
    intelligence.generatedAt,
    intelligence.sourceTranscriptFingerprint,
    intelligence.sourceTranscriptSource,
    intelligence.summary,
    JSON.stringify(intelligence.keyPoints),
    JSON.stringify(intelligence.actionItems),
    JSON.stringify(intelligence.chapters),
    intelligence.processingError,
  ];
}

export async function initializeSessionSchema(database: SessionDatabase): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const versionRow = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = versionRow?.user_version ?? 0;

  if (version > SESSION_DATABASE_VERSION) {
    throw new Error(`Recall database version ${version} is newer than this app supports.`);
  }

  if (version < 1) {
    await database.execAsync(SESSION_SCHEMA_SQL);
    await database.execAsync(`PRAGMA user_version = ${SESSION_DATABASE_VERSION};`);
    return;
  }

  if (version < 2) {
    await database.execAsync(SESSION_SCHEMA_V1_TO_V2_SQL);
  }

  if (version < 3) {
    await database.execAsync(SESSION_SCHEMA_V2_TO_V3_SQL);
  }
}

export interface SessionRepository {
  initialize(): Promise<void>;
  listSessions(): Promise<RecallSession[]>;
  getSession(id: string): Promise<RecallSessionWithBookmarks | null>;
  getIntelligence(id: string): Promise<SessionIntelligence>;
  updateIntelligence(id: string, update: SessionIntelligenceUpdate): Promise<void>;
  createSession(session: RecallSession, bookmarks: SessionBookmark[]): Promise<void>;
  updateSession(id: string, update: SessionTranscriptUpdate): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
}

export function createSessionRepository(database: SessionDatabase): SessionRepository {
  let initialized = false;

  async function initialize(): Promise<void> {
    if (!initialized) {
      await initializeSessionSchema(database);
      initialized = true;
    }
  }

  async function readIntelligence(id: string): Promise<SessionIntelligence> {
    const row = await database.getFirstAsync<SessionIntelligenceRow>(
      'SELECT * FROM session_intelligence WHERE session_id = ?',
      [id],
    );
    return row ? mapIntelligence(row) : createEmptySessionIntelligence(id);
  }

  return {
    initialize,

    async listSessions() {
      await initialize();
      const rows = await database.getAllAsync<SessionRow>(
        'SELECT * FROM sessions ORDER BY created_at DESC',
      );
      return rows.map(mapSession);
    },

    async getSession(id) {
      await initialize();
      const row = await database.getFirstAsync<SessionRow>(
        'SELECT * FROM sessions WHERE id = ?',
        [id],
      );
      if (!row) {
        return null;
      }

      const bookmarkRows = await database.getAllAsync<BookmarkRow>(
        'SELECT * FROM bookmarks WHERE session_id = ? ORDER BY timestamp_ms ASC',
        [id],
      );
      return {
        session: mapSession(row),
        bookmarks: bookmarkRows.map(mapBookmark),
        intelligence: await readIntelligence(id),
      };
    },

    async getIntelligence(id) {
      await initialize();
      return readIntelligence(id);
    },

    async updateIntelligence(id, update) {
      await initialize();
      const sessionRow = await database.getFirstAsync<SessionRow>(
        'SELECT * FROM sessions WHERE id = ?',
        [id],
      );
      if (!sessionRow) {
        throw new Error('Recall session was not found.');
      }

      const current = await readIntelligence(id);
      const next: SessionIntelligence = {
        ...current,
        ...update,
        sessionId: id,
      };
      await database.runAsync(
        `INSERT INTO session_intelligence (
          session_id, status, generated_at, source_transcript_fingerprint, source_transcript_source,
          summary, key_points, action_items, chapters, processing_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          status = excluded.status,
          generated_at = excluded.generated_at,
          source_transcript_fingerprint = excluded.source_transcript_fingerprint,
          source_transcript_source = excluded.source_transcript_source,
          summary = excluded.summary,
          key_points = excluded.key_points,
          action_items = excluded.action_items,
          chapters = excluded.chapters,
          processing_error = excluded.processing_error`,
        intelligenceParams(next),
      );
    },

    async createSession(session, bookmarks) {
      await initialize();
      await database.withTransactionAsync(async () => {
        await database.runAsync(
          `INSERT INTO sessions (
            id, title, created_at, recorded_at, updated_at, duration_ms, audio_uri,
            recording_status, transcript_status, live_transcript, raw_final_transcript,
            repaired_transcript, preferred_transcript, preferred_source, preferred_source_override,
            language_context, processing_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            session.id,
            session.title,
            session.createdAt,
            session.recordedAt,
            session.updatedAt,
            session.durationMs,
            session.audioUri,
            session.recordingStatus,
            session.transcriptStatus,
            session.liveTranscript,
            session.rawFinalTranscript,
            session.repairedTranscript,
            session.preferredTranscript,
            session.preferredTranscriptSource,
            session.preferredTranscriptSourceOverride,
            session.languageContext ? JSON.stringify(session.languageContext) : null,
            session.processingError,
          ],
        );

        for (const bookmark of bookmarks) {
          await database.runAsync(
            'INSERT INTO bookmarks (id, session_id, timestamp_ms, created_at) VALUES (?, ?, ?, ?)',
            [bookmark.id, bookmark.sessionId, bookmark.elapsedTimestampMs, bookmark.createdAt],
          );
        }

        await database.runAsync(
          `INSERT INTO session_intelligence (
            session_id, status, generated_at, source_transcript_fingerprint, source_transcript_source,
            summary, key_points, action_items, chapters, processing_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          intelligenceParams(createEmptySessionIntelligence(session.id)),
        );
      });
    },

    async updateSession(id, update) {
      await initialize();
      const current = await database.getFirstAsync<SessionRow>(
        'SELECT * FROM sessions WHERE id = ?',
        [id],
      );
      if (!current) {
        throw new Error('Recall session was not found.');
      }

      const next = buildTranscriptUpdate(mapSession(current), update);
      const updatedAt = new Date().toISOString();
      await database.runAsync(
        `UPDATE sessions SET
          updated_at = ?, live_transcript = ?, raw_final_transcript = ?,
          repaired_transcript = ?, preferred_transcript = ?, preferred_source = ?, preferred_source_override = ?,
          transcript_status = COALESCE(?, transcript_status), processing_error = ?
         WHERE id = ?`,
        [
          updatedAt,
          next.liveTranscript ?? current.live_transcript,
          next.rawFinalTranscript === undefined ? current.raw_final_transcript : next.rawFinalTranscript,
          next.repairedTranscript === undefined ? current.repaired_transcript : next.repairedTranscript,
          next.preferredTranscript,
          next.preferredTranscriptSource,
          next.preferredTranscriptSourceOverride,
          update.transcriptStatus ?? null,
          update.processingError === undefined ? current.processing_error : update.processingError,
          id,
        ],
      );
    },

    async renameSession(id, title) {
      await initialize();
      const nextTitle = title.trim();
      if (!nextTitle) {
        throw new Error('A session title cannot be empty.');
      }
      await database.runAsync(
        'UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?',
        [nextTitle, new Date().toISOString(), id],
      );
    },

    async deleteSession(id) {
      await initialize();
      await database.runAsync('DELETE FROM sessions WHERE id = ?', [id]);
    },
  };
}

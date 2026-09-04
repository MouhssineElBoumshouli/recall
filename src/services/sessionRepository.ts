import type { SQLiteBindValue } from 'expo-sqlite';

import type {
  RecallSession,
  RecallSessionWithBookmarks,
  SessionBookmark,
  SessionTranscriptUpdate,
} from '@/types/session';
import { buildTranscriptUpdate } from '@/services/transcriptPreference';

export type SqliteValue = SQLiteBindValue;

export interface SessionDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params?: SqliteValue[]): Promise<unknown>;
  getFirstAsync<T>(source: string, params?: SqliteValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, params?: SqliteValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export const SESSION_DATABASE_VERSION = 2;

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
`;

export const SESSION_SCHEMA_V1_TO_V2_SQL = `
ALTER TABLE sessions RENAME COLUMN authoritative_transcript TO preferred_transcript;
ALTER TABLE sessions RENAME COLUMN authoritative_source TO preferred_source;
ALTER TABLE sessions ADD COLUMN preferred_source_override TEXT;
PRAGMA user_version = 2;
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
}

export interface SessionRepository {
  initialize(): Promise<void>;
  listSessions(): Promise<RecallSession[]>;
  getSession(id: string): Promise<RecallSessionWithBookmarks | null>;
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
      return { session: mapSession(row), bookmarks: bookmarkRows.map(mapBookmark) };
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

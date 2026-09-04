import type { Bookmark } from './bookmark';
import type { TranscriptLanguageContext } from './languageContext';

export type RecordingStatus = 'complete' | 'failed';
export type TranscriptStatus = 'pending' | 'processing' | 'succeeded' | 'failed';
export type AuthoritativeTranscriptSource = 'repaired' | 'raw-final' | 'live-finalized' | 'none';

export interface RecallSession {
  id: string;
  title: string;
  createdAt: string;
  recordedAt: string;
  updatedAt: string;
  durationMs: number;
  audioUri: string;
  recordingStatus: RecordingStatus;
  transcriptStatus: TranscriptStatus;
  liveTranscript: string;
  rawFinalTranscript: string | null;
  repairedTranscript: string | null;
  authoritativeTranscript: string;
  authoritativeTranscriptSource: AuthoritativeTranscriptSource;
  languageContext: TranscriptLanguageContext | null;
  processingError: string | null;
}

export interface SessionBookmark extends Bookmark {
  sessionId: string;
}

export interface RecallSessionWithBookmarks {
  session: RecallSession;
  bookmarks: SessionBookmark[];
}

export interface SessionTranscriptUpdate {
  liveTranscript?: string;
  rawFinalTranscript?: string | null;
  repairedTranscript?: string | null;
  transcriptStatus?: TranscriptStatus;
  processingError?: string | null;
}


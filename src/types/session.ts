import type { Bookmark } from './bookmark';
import type { TranscriptLanguageContext } from './languageContext';

export type RecordingStatus = 'complete' | 'failed';
export type TranscriptStatus = 'pending' | 'processing' | 'succeeded' | 'failed';
export type PreferredTranscriptSource = 'repaired' | 'raw-final' | 'live-finalized' | 'none';
export type PreferredTranscriptSourceOverride = Exclude<PreferredTranscriptSource, 'none'> | null;

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
  preferredTranscript: string;
  preferredTranscriptSource: PreferredTranscriptSource;
  preferredTranscriptSourceOverride: PreferredTranscriptSourceOverride;
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
  preferredTranscriptSourceOverride?: PreferredTranscriptSourceOverride;
  transcriptStatus?: TranscriptStatus;
  processingError?: string | null;
}

import { joinFinalTranscript } from '@/services/transcriptAccumulator';
import { selectAuthoritativeTranscript } from '@/services/transcriptAuthority';
import type { Bookmark } from '@/types/bookmark';
import type { RecallSession, SessionBookmark } from '@/types/session';
import type { TranscriptSegment } from '@/types/transcript';

function createSessionId(now = Date.now()): string {
  return `session-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultSessionTitle(recordedAt: string): string {
  const date = new Date(recordedAt);
  return `Recording — ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export interface NewSessionInput {
  id?: string;
  recordedAt: string;
  durationMs: number;
  audioUri: string;
  finalizedSegments: TranscriptSegment[];
  bookmarks: Bookmark[];
}

export function createNewSession(input: NewSessionInput): {
  session: RecallSession;
  bookmarks: SessionBookmark[];
} {
  const id = input.id || createSessionId();
  const liveTranscript = joinFinalTranscript(input.finalizedSegments);
  const authoritative = selectAuthoritativeTranscript({
    liveTranscript,
    rawFinalTranscript: null,
    repairedTranscript: null,
  });
  const now = new Date().toISOString();

  return {
    session: {
      id,
      title: defaultSessionTitle(input.recordedAt),
      createdAt: now,
      recordedAt: input.recordedAt,
      updatedAt: now,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      audioUri: input.audioUri,
      recordingStatus: 'complete',
      transcriptStatus: 'processing',
      liveTranscript,
      rawFinalTranscript: null,
      repairedTranscript: null,
      authoritativeTranscript: authoritative.text,
      authoritativeTranscriptSource: authoritative.source,
      languageContext: null,
      processingError: null,
    },
    bookmarks: input.bookmarks.map((bookmark) => ({ ...bookmark, sessionId: id })),
  };
}


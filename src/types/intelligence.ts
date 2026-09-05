import type { TranscriptLanguageContext } from './languageContext';
import type { PreferredTranscriptSource } from './session';

export type SessionIntelligenceStatus = 'not-started' | 'processing' | 'succeeded' | 'failed';

export interface SessionIntelligenceActionItem {
  id: string;
  text: string;
  owner: string | null;
  dueDate: string | null;
}

export interface SessionIntelligenceChapter {
  id: string;
  title: string;
  summary: string;
  startTimestampMs: number | null;
}

export interface SessionIntelligence {
  sessionId: string;
  status: SessionIntelligenceStatus;
  generatedAt: string | null;
  sourceTranscriptFingerprint: string | null;
  sourceTranscriptSource: PreferredTranscriptSource;
  summary: string;
  keyPoints: string[];
  actionItems: SessionIntelligenceActionItem[];
  chapters: SessionIntelligenceChapter[];
  processingError: string | null;
}

export interface SessionIntelligenceUpdate {
  status?: SessionIntelligenceStatus;
  generatedAt?: string | null;
  sourceTranscriptFingerprint?: string | null;
  sourceTranscriptSource?: PreferredTranscriptSource;
  summary?: string;
  keyPoints?: string[];
  actionItems?: SessionIntelligenceActionItem[];
  chapters?: SessionIntelligenceChapter[];
  processingError?: string | null;
}

export interface SessionIntelligenceContent {
  summary: string;
  keyPoints: string[];
  actionItems: {
    text: string;
    owner: string | null;
    dueDate: string | null;
  }[];
  chapters: {
    title: string;
    summary: string;
    startTimestampMs: number | null;
  }[];
}

export interface SessionIntelligenceGenerationInput {
  preferredTranscript: string;
  languageContext: TranscriptLanguageContext | null;
  sessionMetadata?: {
    sessionId: string;
    title: string;
    recordedAt: string;
    durationMs: number;
  };
}

export function createEmptySessionIntelligence(sessionId: string): SessionIntelligence {
  return {
    sessionId,
    status: 'not-started',
    generatedAt: null,
    sourceTranscriptFingerprint: null,
    sourceTranscriptSource: 'none',
    summary: '',
    keyPoints: [],
    actionItems: [],
    chapters: [],
    processingError: null,
  };
}

import { getPreferredTranscript } from '@/services/transcriptPreference';
import { fingerprintTranscript } from '@/services/transcriptFingerprint';
import type {
  SessionIntelligence,
  SessionIntelligenceContent,
  SessionIntelligenceGenerationInput,
} from '@/types/intelligence';
import type { SessionRepository } from '@/services/sessionRepository';

export interface SessionIntelligenceGenerator {
  generate(input: SessionIntelligenceGenerationInput): Promise<SessionIntelligenceContent>;
}

export interface SessionIntelligenceRunGate {
  run(id: string, task: () => Promise<void>): Promise<void>;
}

export function createSessionIntelligenceRunGate(): SessionIntelligenceRunGate {
  const inFlight = new Map<string, Promise<void>>();

  return {
    run(id, task) {
      const existing = inFlight.get(id);
      if (existing) {
        return existing;
      }

      const operation = task().finally(() => {
        inFlight.delete(id);
      });
      inFlight.set(id, operation);
      return operation;
    },
  };
}

function materializeIntelligence(
  sessionId: string,
  sourceTranscriptFingerprint: string,
  sourceTranscriptSource: SessionIntelligence['sourceTranscriptSource'],
  content: SessionIntelligenceContent,
  generatedAt: string,
): SessionIntelligence {
  return {
    sessionId,
    status: 'succeeded',
    generatedAt,
    sourceTranscriptFingerprint,
    sourceTranscriptSource,
    summary: content.summary,
    keyPoints: content.keyPoints,
    actionItems: content.actionItems.map((item, index) => ({
      id: `${sessionId}-action-${index + 1}`,
      ...item,
    })),
    chapters: content.chapters.map((chapter, index) => ({
      id: `${sessionId}-chapter-${index + 1}`,
      ...chapter,
    })),
    processingError: null,
  };
}

export async function runSessionIntelligence(
  sessionId: string,
  repository: SessionRepository,
  generator: SessionIntelligenceGenerator,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const detail = await repository.getSession(sessionId);
  if (!detail) {
    throw new Error('Recall session was not found.');
  }

  const preferred = getPreferredTranscript(detail.session);
  if (!preferred.text) {
    await repository.updateIntelligence(sessionId, {
      status: 'not-started',
      generatedAt: null,
      sourceTranscriptFingerprint: null,
      sourceTranscriptSource: 'none',
      summary: '',
      keyPoints: [],
      actionItems: [],
      chapters: [],
      processingError: null,
    });
    return;
  }

  const sourceTranscriptFingerprint = fingerprintTranscript(preferred.text);
  const sourceTranscriptSource = preferred.source;
  await repository.updateIntelligence(sessionId, {
    status: 'processing',
    generatedAt: null,
    sourceTranscriptFingerprint,
    sourceTranscriptSource,
    summary: '',
    keyPoints: [],
    actionItems: [],
    chapters: [],
    processingError: null,
  });

  try {
    const content = await generator.generate({
      preferredTranscript: preferred.text,
      languageContext: detail.session.languageContext,
      sessionMetadata: {
        sessionId: detail.session.id,
        title: detail.session.title,
        recordedAt: detail.session.recordedAt,
        durationMs: detail.session.durationMs,
      },
    });
    await repository.updateIntelligence(sessionId, materializeIntelligence(
      sessionId,
      sourceTranscriptFingerprint,
      sourceTranscriptSource,
      content,
      now(),
    ));
  } catch {
    await repository.updateIntelligence(sessionId, {
      status: 'failed',
      generatedAt: null,
      sourceTranscriptFingerprint,
      sourceTranscriptSource,
      summary: '',
      keyPoints: [],
      actionItems: [],
      chapters: [],
      processingError: 'Notes could not be generated.',
    });
  }
}

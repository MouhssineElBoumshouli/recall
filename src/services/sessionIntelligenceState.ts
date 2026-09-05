import { getPreferredTranscript } from '@/services/transcriptPreference';
import { fingerprintTranscript } from '@/services/transcriptFingerprint';
import type { SessionIntelligence } from '@/types/intelligence';
import type { RecallSession } from '@/types/session';

export function isSessionIntelligenceStale(
  session: Pick<RecallSession, 'liveTranscript' | 'rawFinalTranscript' | 'repairedTranscript' | 'preferredTranscriptSourceOverride'>,
  intelligence: Pick<SessionIntelligence, 'status' | 'sourceTranscriptFingerprint' | 'sourceTranscriptSource'>,
): boolean {
  if (intelligence.status !== 'succeeded') {
    return false;
  }

  const preferred = getPreferredTranscript(session);
  const currentFingerprint = preferred.text ? fingerprintTranscript(preferred.text) : null;
  return intelligence.sourceTranscriptFingerprint !== currentFingerprint || intelligence.sourceTranscriptSource !== preferred.source;
}

import type {
  AuthoritativeTranscriptSource,
  RecallSession,
  SessionTranscriptUpdate,
} from '@/types/session';

export interface TranscriptLayers {
  liveTranscript: string;
  rawFinalTranscript: string | null;
  repairedTranscript: string | null;
}

export interface AuthoritativeTranscript {
  text: string;
  source: AuthoritativeTranscriptSource;
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim() || '';
  return normalized ? normalized : null;
}

export function selectAuthoritativeTranscript(layers: TranscriptLayers): AuthoritativeTranscript {
  const repaired = nonEmpty(layers.repairedTranscript);
  if (repaired) {
    return { text: repaired, source: 'repaired' };
  }

  const rawFinal = nonEmpty(layers.rawFinalTranscript);
  if (rawFinal) {
    return { text: rawFinal, source: 'raw-final' };
  }

  const live = nonEmpty(layers.liveTranscript);
  if (live) {
    return { text: live, source: 'live-finalized' };
  }

  return { text: '', source: 'none' };
}

export function buildTranscriptUpdate(
  current: Pick<RecallSession, 'liveTranscript' | 'rawFinalTranscript' | 'repairedTranscript'>,
  update: SessionTranscriptUpdate,
): SessionTranscriptUpdate & AuthoritativeTranscript {
  const layers = {
    liveTranscript: update.liveTranscript ?? current.liveTranscript,
    rawFinalTranscript: update.rawFinalTranscript === undefined
      ? current.rawFinalTranscript
      : update.rawFinalTranscript,
    repairedTranscript: update.repairedTranscript === undefined
      ? current.repairedTranscript
      : update.repairedTranscript,
  };
  const authoritative = selectAuthoritativeTranscript(layers);
  return { ...update, ...authoritative };
}


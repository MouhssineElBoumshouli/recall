import type {
  PreferredTranscriptSource,
  PreferredTranscriptSourceOverride,
  RecallSession,
  SessionTranscriptUpdate,
} from '@/types/session';

export interface TranscriptLayers {
  liveTranscript: string;
  rawFinalTranscript: string | null;
  repairedTranscript: string | null;
}

export interface PreferredTranscript {
  text: string;
  source: PreferredTranscriptSource;
}

export interface PreferredTranscriptProjection {
  preferredTranscript: string;
  preferredTranscriptSource: PreferredTranscriptSource;
  preferredTranscriptSourceOverride: PreferredTranscriptSourceOverride;
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim() || '';
  return normalized ? normalized : null;
}

function transcriptForSource(layers: TranscriptLayers, source: PreferredTranscriptSourceOverride): string | null {
  if (source === 'repaired') {
    return nonEmpty(layers.repairedTranscript);
  }
  if (source === 'raw-final') {
    return nonEmpty(layers.rawFinalTranscript);
  }
  if (source === 'live-finalized') {
    return nonEmpty(layers.liveTranscript);
  }
  return null;
}

/**
 * Resolves Recall's current preferred transcript. The default order is a
 * replaceable preference, not an accuracy or ground-truth guarantee.
 */
export function resolvePreferredTranscript(
  layers: TranscriptLayers,
  sourceOverride: PreferredTranscriptSourceOverride = null,
): PreferredTranscript {
  if (sourceOverride) {
    const overriddenText = transcriptForSource(layers, sourceOverride);
    if (overriddenText) {
      return { text: overriddenText, source: sourceOverride };
    }
  }

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

/** Stable downstream accessor for the transcript currently selected by Recall. */
export function getPreferredTranscript(
  session: Pick<RecallSession, 'liveTranscript' | 'rawFinalTranscript' | 'repairedTranscript' | 'preferredTranscriptSourceOverride'>,
): PreferredTranscript {
  return resolvePreferredTranscript(
    {
      liveTranscript: session.liveTranscript,
      rawFinalTranscript: session.rawFinalTranscript,
      repairedTranscript: session.repairedTranscript,
    },
    session.preferredTranscriptSourceOverride,
  );
}

export function buildTranscriptUpdate(
  current: Pick<RecallSession, 'liveTranscript' | 'rawFinalTranscript' | 'repairedTranscript' | 'preferredTranscriptSourceOverride'>,
  update: SessionTranscriptUpdate,
): SessionTranscriptUpdate & PreferredTranscriptProjection {
  const layers: TranscriptLayers = {
    liveTranscript: update.liveTranscript ?? current.liveTranscript,
    rawFinalTranscript: update.rawFinalTranscript === undefined
      ? current.rawFinalTranscript
      : update.rawFinalTranscript,
    repairedTranscript: update.repairedTranscript === undefined
      ? current.repairedTranscript
      : update.repairedTranscript,
  };
  const sourceOverride = update.preferredTranscriptSourceOverride === undefined
    ? current.preferredTranscriptSourceOverride
    : update.preferredTranscriptSourceOverride;
  const preferred = resolvePreferredTranscript(layers, sourceOverride);
  return {
    ...update,
    preferredTranscript: preferred.text,
    preferredTranscriptSource: preferred.source,
    preferredTranscriptSourceOverride: sourceOverride,
  };
}

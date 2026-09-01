import type { TranscriptRefinementState } from '@/types/refinement';

export const initialRefinementState: TranscriptRefinementState = {
  status: 'idle',
  text: null,
  model: null,
  error: null,
  attempts: 0,
  completedAt: null,
};

export function refinementStarted(previous: TranscriptRefinementState): TranscriptRefinementState {
  return {
    ...previous,
    status: 'refining',
    error: null,
    attempts: previous.attempts + 1,
  };
}

export function refinementSucceeded(
  previous: TranscriptRefinementState,
  text: string,
  model: string,
  completedAt: string,
): TranscriptRefinementState {
  return {
    ...previous,
    status: 'succeeded',
    text,
    model,
    error: null,
    completedAt,
  };
}

export function refinementFailed(
  previous: TranscriptRefinementState,
  error: string,
): TranscriptRefinementState {
  return {
    ...previous,
    status: 'failed',
    error,
  };
}

export function canRetryRefinement(state: TranscriptRefinementState): boolean {
  return state.status === 'failed';
}

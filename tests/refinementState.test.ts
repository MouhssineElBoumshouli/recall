import { describe, expect, it } from 'vitest';

import {
  canRetryRefinement,
  initialRefinementState,
  refinementFailed,
  refinementStarted,
  refinementSucceeded,
} from '@/services/refinementState';

describe('refinement state', () => {
  it('transitions from idle to refining and then succeeded', () => {
    const started = refinementStarted(initialRefinementState);
    const completed = refinementSucceeded(started, 'Refined words.', 'gemini-3.5-transcribe', '2026-09-01T00:00:00.000Z');

    expect(started).toMatchObject({ status: 'refining', attempts: 1, text: null });
    expect(completed).toMatchObject({
      status: 'succeeded',
      text: 'Refined words.',
      model: 'gemini-3.5-transcribe',
      completedAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('preserves local/live recording state when refinement fails and supports retry', () => {
    const liveTranscript = 'Live transcript remains available.';
    const localAudioUri = 'file:/recording.wav';
    const failed = refinementFailed(refinementStarted(initialRefinementState), 'Server unavailable.');
    const retry = refinementStarted(failed);

    expect({ liveTranscript, localAudioUri }).toEqual({
      liveTranscript: 'Live transcript remains available.',
      localAudioUri: 'file:/recording.wav',
    });
    expect(failed).toMatchObject({ status: 'failed', error: 'Server unavailable.', attempts: 1 });
    expect(canRetryRefinement(failed)).toBe(true);
    expect(retry).toMatchObject({ status: 'refining', error: null, attempts: 2 });
  });

  it('keeps refined output distinct from live output', () => {
    const state = refinementSucceeded(
      refinementStarted(initialRefinementState),
      'Refined transcript.',
      'gemini-3.5-transcribe',
      '2026-09-01T00:00:00.000Z',
    );

    expect(state.text).not.toBe('Live transcript.');
    expect(state.text).toBe('Refined transcript.');
  });
});

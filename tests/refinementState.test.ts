import { describe, expect, it } from 'vitest';

import {
  canRetryRefinement,
  initialRefinementState,
  refinementFailed,
  refinementStarted,
  refinementSucceeded,
} from '@/services/refinementState';
import { RefinementAttemptController } from '@/services/refinementAttemptController';

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

  it('supports a retry that fails again without losing the first failure context', () => {
    const firstFailure = refinementFailed(refinementStarted(initialRefinementState), 'First attempt failed.');
    const retrying = refinementStarted(firstFailure);
    const secondFailure = refinementFailed(retrying, 'Second attempt failed.');

    expect(retrying).toMatchObject({ status: 'refining', attempts: 2, error: null });
    expect(secondFailure).toMatchObject({ status: 'failed', attempts: 2, error: 'Second attempt failed.' });
  });

  it('prevents duplicate refinement attempts while one request is in flight', () => {
    const controller = new RefinementAttemptController();
    const firstAttempt = controller.begin();

    expect(firstAttempt).not.toBeNull();
    expect(controller.begin()).toBeNull();

    controller.finish(firstAttempt as number);
    expect(controller.begin()).not.toBeNull();
  });
});

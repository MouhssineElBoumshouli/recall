import { describe, expect, it } from 'vitest';

import {
  GEMINI_ROTATION_THRESHOLD_MS,
  getRotationDelayMs,
  sessionRelativeToRecordingTimestamp,
  shouldRotateSession,
} from '@/services/sessionTiming';

describe('session timing', () => {
  it('rotates at the configured pre-limit threshold', () => {
    expect(shouldRotateSession(GEMINI_ROTATION_THRESHOLD_MS - 1, 0)).toBe(false);
    expect(shouldRotateSession(GEMINI_ROTATION_THRESHOLD_MS, 0)).toBe(true);
  });

  it('calculates the remaining rotation delay without going negative', () => {
    expect(getRotationDelayMs(1_000, 0, 8_000)).toBe(7_000);
    expect(getRotationDelayMs(9_000, 0, 8_000)).toBe(0);
  });

  it('converts a timestamp within a Gemini session to overall recording time', () => {
    expect(sessionRelativeToRecordingTimestamp(510_000, 2_400)).toBe(512_400);
    expect(sessionRelativeToRecordingTimestamp(510_000, -1)).toBe(510_000);
  });
});

export const GEMINI_SESSION_LIMIT_MS = 10 * 60 * 1_000;
export const GEMINI_ROTATION_THRESHOLD_MS = 8.5 * 60 * 1_000;

export function shouldRotateSession(
  nowMs: number,
  sessionStartedAtMs: number,
  rotationThresholdMs = GEMINI_ROTATION_THRESHOLD_MS,
): boolean {
  return nowMs - sessionStartedAtMs >= rotationThresholdMs;
}

export function getRotationDelayMs(
  nowMs: number,
  sessionStartedAtMs: number,
  rotationThresholdMs = GEMINI_ROTATION_THRESHOLD_MS,
): number {
  return Math.max(0, rotationThresholdMs - (nowMs - sessionStartedAtMs));
}

export function sessionRelativeToRecordingTimestamp(
  sessionStartOverallMs: number,
  sessionRelativeTimestampMs: number,
): number {
  return Math.max(0, sessionStartOverallMs + Math.max(0, sessionRelativeTimestampMs));
}

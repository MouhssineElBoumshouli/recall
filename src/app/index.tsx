import { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, displayFont, layout, radii, spacing, typography } from '@/design/tokens';
import { useRecordingSession } from '@/hooks/useRecordingSession';
import type { Bookmark } from '@/types/bookmark';
import type { StoppedRecording } from '@/types/recording';
import type { TranscriptSegment } from '@/types/transcript';
import { formatElapsedMs, formatTimestampMs } from '@/utils/time';

function PressableButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primaryButton,
        variant === 'secondary' && styles.secondaryButton,
        variant === 'danger' && styles.dangerButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          variant === 'primary' && styles.primaryButtonLabel,
          variant === 'danger' && styles.dangerButtonLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function LiveAmplitude({ amplitude }: { amplitude: number }) {
  const bars = useMemo(
    () =>
      Array.from(
        { length: 11 },
        (_, index) => Math.max(0.2, amplitude * (0.6 + ((index * 17) % 5) / 10)),
      ),
    [amplitude],
  );

  return (
    <View accessibilityLabel="Live microphone amplitude" style={styles.amplitude}>
      {bars.map((height, index) => (
        <View key={index} style={[styles.amplitudeBar, { height: 10 + height * 26 }]} />
      ))}
    </View>
  );
}

function Header({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.wordmarkRow}>
        <View style={styles.wordmarkMark} />
        <Text style={styles.wordmark}>RECALL</Text>
        <Text style={styles.phaseMark}>{eyebrow}</Text>
      </View>
      <Text style={styles.pageTitle}>{title}</Text>
    </View>
  );
}

function IdleScreen({
  phase,
  error,
  onStart,
}: {
  phase: string;
  error: string | null;
  onStart: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Header eyebrow="PHASE 0 / SPIKE" title="Hold on to the moment." />
      <View style={styles.introBlock}>
        <Text style={styles.introText}>
          A local-first recorder for the things worth remembering — lectures, conversations, ideas, and the space between them.
        </Text>
        <Text style={styles.languageNote}>ENGLISH · FRANÇAIS · العربية · DARIJA</Text>
      </View>
      <View style={styles.rule} />
      <View style={styles.startBlock}>
        <Text style={styles.helperText}>
          One recording pipeline keeps the original audio safe while live transcription catches up when it can.
        </Text>
        <PressableButton
          label={phase === 'starting' ? 'Requesting microphone…' : 'Start recording'}
          onPress={onStart}
          disabled={phase === 'starting'}
        />
      </View>
      <View style={styles.debugFooter}>
        <Text style={styles.debugText}>NATIVE PCM CAPTURE · GEMINI LIVE · LOCAL FILE</Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </ScrollView>
  );
}

function TranscriptLines({ segments }: { segments: TranscriptSegment[] }) {
  return (
    <>
      {segments.map((segment) => (
        <View key={segment.id} style={styles.transcriptLine}>
          <Text style={styles.timestamp}>{formatTimestampMs(segment.relativeTimestampMs)}</Text>
          <Text style={styles.transcriptText}>{segment.text}</Text>
        </View>
      ))}
    </>
  );
}

function RecordingScreen({
  elapsedMs,
  connectionState,
  finalizedSegments,
  interimText,
  bookmarks,
  amplitude,
  error,
  onBookmark,
  onStop,
}: {
  elapsedMs: number;
  connectionState: string;
  finalizedSegments: TranscriptSegment[];
  interimText: string | null;
  bookmarks: Bookmark[];
  amplitude: number;
  error: string | null;
  onBookmark: () => void;
  onStop: () => void;
}) {
  const connectionLabel = {
    connected: 'Live connection',
    connecting: 'Connecting to Gemini',
    rotating: 'Rotating live session',
    reconnecting: 'Reconnecting — audio continues',
    unavailable: 'Live transcription unavailable',
    stopping: 'Finishing capture',
  }[connectionState] || 'Preparing live connection';

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <View style={styles.recordingHeader}>
        <View style={styles.wordmarkRow}>
          <View style={[styles.wordmarkMark, styles.recordingMark]} />
          <Text style={styles.wordmark}>RECALL</Text>
          <Text style={styles.phaseMark}>RECORDING</Text>
        </View>
        <Text style={styles.timer}>{formatElapsedMs(elapsedMs)}</Text>
      </View>

      <View style={styles.liveStrip}>
        <LiveAmplitude amplitude={amplitude} />
        <View style={styles.connectionCopy}>
          <Text style={styles.connectionLabel}>{connectionLabel}</Text>
          <Text style={styles.connectionHint}>The local recording is the source of truth.</Text>
        </View>
      </View>

      <View style={styles.transcriptHeader}>
        <SectionLabel>LIVE TRANSCRIPT</SectionLabel>
        <Text style={styles.segmentCount}>{finalizedSegments.length} finalized</Text>
      </View>
      <View style={styles.transcriptBlock}>
        {finalizedSegments.length === 0 && !interimText && (
          <Text style={styles.emptyTranscript}>Speak naturally. Finalized lines will appear here.</Text>
        )}
        <TranscriptLines segments={finalizedSegments} />
        {interimText && (
          <View style={[styles.transcriptLine, styles.interimLine]}>
            <Text style={styles.timestamp}>LIVE</Text>
            <Text style={styles.interimText}>{interimText}</Text>
          </View>
        )}
      </View>

      <View style={styles.recordingFooter}>
        <View style={styles.bookmarkSummary}>
          <Text style={styles.bookmarkCount}>{bookmarks.length}</Text>
          <Text style={styles.helperText}>bookmarks placed</Text>
        </View>
        <View style={styles.actionRow}>
          <PressableButton label="Bookmark" onPress={onBookmark} variant="secondary" />
          <PressableButton label="Stop" onPress={onStop} variant="danger" disabled={connectionState === 'stopping'} />
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </ScrollView>
  );
}

function StoppedScreen({
  stoppedRecording,
  error,
  onReset,
}: {
  stoppedRecording: StoppedRecording;
  error: string | null;
  onReset: () => void;
}) {
  const { recording, durationMs, finalizedSegments, bookmarks, debug } = stoppedRecording;
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Header eyebrow="CAPTURE COMPLETE" title="Captured." />
      <View style={styles.metaList}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>DURATION</Text>
          <Text style={styles.metaValue}>{formatElapsedMs(durationMs)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>LOCAL AUDIO</Text>
          <Text selectable style={styles.metaValuePath}>
            {recording?.fileUri || 'Audio file was not returned by the native recorder.'}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>FINALIZED</Text>
          <Text style={styles.metaValue}>{finalizedSegments.length} segments</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>BOOKMARKS</Text>
          <Text style={styles.metaValue}>{bookmarks.length}</Text>
        </View>
      </View>

      <View style={styles.rule} />
      <SectionLabel>TRANSCRIPT</SectionLabel>
      <View style={styles.transcriptBlock}>
        {finalizedSegments.length === 0 ? (
          <Text style={styles.emptyTranscript}>No finalized transcript segments were received.</Text>
        ) : (
          <TranscriptLines segments={finalizedSegments} />
        )}
      </View>

      <View style={styles.debugPanel}>
        <SectionLabel>SPIKE DEBUG</SectionLabel>
        <Text style={styles.debugText}>
          {debug.connectionState} · generation {debug.sessionGeneration} · {debug.rotationCount} rotations
        </Text>
        <Text style={styles.debugText}>
          {debug.reconnectAttempts} reconnect attempts · {debug.droppedAudioChunks} audio chunks dropped while unavailable
        </Text>
        <Text style={styles.debugText}>
          {debug.socketOpened ? 'socket opened' : 'socket not opened'} ·{' '}
          {debug.setupComplete ? 'setup complete' : 'setup pending'} · {debug.audioChunksSent} audio chunks sent ·{' '}
          {debug.serverMessagesReceived} server messages
        </Text>
        <Text style={styles.debugText}>
          {debug.tokenFetched ? 'token fetched' : 'token not fetched'} ·{' '}
          {debug.setupMessageSent ? 'setup sent' : 'setup not sent'} ·{' '}
          {debug.setupTimedOut ? 'setup timeout' : 'no setup timeout'} · {debug.socketErrorCount} socket errors
        </Text>
        <Text style={styles.debugText}>
          {debug.interimTranscriptEvents} interim · {debug.finalTranscriptEvents} final ·{' '}
          {debug.turnCompleteReceived ? 'turn complete received' : 'turn incomplete'} ·{' '}
          {debug.audioStreamEndSent ? 'audio end sent' : 'audio end not sent'} ·{' '}
          {debug.lastServerMessageDataType || 'no server message type'}
        </Text>
        {debug.lastCloseCode !== null && (
          <Text style={styles.debugText}>
            Last close: {debug.lastCloseCode} {debug.lastCloseReason || 'no reason'}
          </Text>
        )}
        {debug.lastError && <Text style={styles.errorText}>Last live error: {debug.lastError}</Text>}
        {error && <Text style={styles.errorText}>Recording finalization: {error}</Text>}
      </View>
      <PressableButton label="Start another recording" onPress={onReset} />
    </ScrollView>
  );
}

export default function RecallScreen() {
  const session = useRecordingSession();

  if (session.phase === 'recording' || session.phase === 'stopping') {
    return (
      <View style={styles.container}>
        <RecordingScreen
          elapsedMs={session.elapsedMs}
          connectionState={session.connectionState}
          finalizedSegments={session.finalizedSegments}
          interimText={session.interimText}
          bookmarks={session.bookmarks}
          amplitude={session.amplitude}
          error={session.error}
          onBookmark={session.addBookmark}
          onStop={session.stop}
        />
      </View>
    );
  }

  if (session.phase === 'stopped' && session.stoppedRecording) {
    return (
      <View style={styles.container}>
        <StoppedScreen stoppedRecording={session.stoppedRecording} error={session.error} onReset={session.reset} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <IdleScreen phase={session.phase} error={session.error} onStart={session.start} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  header: {
    gap: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  wordmarkMark: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  recordingMark: {
    backgroundColor: colors.danger,
  },
  wordmark: {
    color: colors.ink,
    fontSize: typography.eyebrow,
    fontWeight: '800',
    letterSpacing: 2,
  },
  phaseMark: {
    color: colors.faintInk,
    fontSize: typography.eyebrow,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  pageTitle: {
    maxWidth: 480,
    color: colors.ink,
    fontFamily: displayFont,
    fontSize: typography.display,
    fontWeight: '700',
    letterSpacing: -1.5,
    lineHeight: 60,
  },
  introBlock: {
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  introText: {
    color: colors.ink,
    fontSize: typography.bodyLarge,
    lineHeight: 28,
    maxWidth: 560,
  },
  languageNote: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  rule: {
    height: 1,
    backgroundColor: colors.line,
  },
  startBlock: {
    gap: spacing.lg,
    paddingTop: spacing.xl,
  },
  helperText: {
    color: colors.mutedInk,
    fontSize: typography.body,
    lineHeight: 24,
  },
  button: {
    minHeight: layout.touchTarget,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButton: {
    backgroundColor: colors.ink,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dangerButton: {
    flex: 1,
    backgroundColor: colors.danger,
  },
  buttonLabel: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '700',
  },
  primaryButtonLabel: {
    color: colors.white,
  },
  dangerButtonLabel: {
    color: colors.white,
  },
  disabledButton: {
    opacity: 0.55,
  },
  pressedButton: {
    opacity: 0.78,
  },
  debugFooter: {
    gap: spacing.sm,
    paddingTop: spacing.xxl,
  },
  debugText: {
    color: colors.faintInk,
    fontSize: typography.caption,
    lineHeight: 20,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.caption,
    lineHeight: 20,
  },
  recordingHeader: {
    gap: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  timer: {
    color: colors.ink,
    fontSize: typography.timer,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontVariant: ['tabular-nums'],
  },
  liveStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  amplitude: {
    width: 130,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amplitudeBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  connectionCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  connectionLabel: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '700',
  },
  connectionHint: {
    color: colors.mutedInk,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
  },
  sectionLabel: {
    color: colors.faintInk,
    fontSize: typography.eyebrow,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  segmentCount: {
    color: colors.mutedInk,
    fontSize: typography.caption,
  },
  transcriptBlock: {
    gap: spacing.lg,
    paddingVertical: spacing.lg,
  },
  transcriptLine: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  timestamp: {
    width: 42,
    paddingTop: 4,
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  transcriptText: {
    flex: 1,
    color: colors.ink,
    fontSize: typography.bodyLarge,
    lineHeight: 28,
  },
  interimLine: {
    opacity: 0.7,
  },
  interimText: {
    flex: 1,
    color: colors.mutedInk,
    fontSize: typography.bodyLarge,
    fontStyle: 'italic',
    lineHeight: 28,
  },
  emptyTranscript: {
    color: colors.mutedInk,
    fontSize: typography.body,
    lineHeight: 24,
  },
  recordingFooter: {
    gap: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: spacing.lg,
  },
  bookmarkSummary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  bookmarkCount: {
    color: colors.accent,
    fontFamily: displayFont,
    fontSize: typography.title,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metaList: {
    paddingBottom: spacing.xl,
  },
  metaRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  metaLabel: {
    width: 86,
    color: colors.faintInk,
    fontSize: typography.eyebrow,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  metaValue: {
    flex: 1,
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '600',
  },
  metaValuePath: {
    flex: 1,
    color: colors.mutedInk,
    fontSize: typography.caption,
    lineHeight: 20,
  },
  debugPanel: {
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    marginBottom: spacing.xl,
  },
});

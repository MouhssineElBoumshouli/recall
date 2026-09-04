import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors, displayFont, layout, radii, spacing, typography } from '@/design/tokens';
import { useRecordingSession } from '@/hooks/useRecordingSession';
import type { Bookmark } from '@/types/bookmark';
import type { TranscriptSegment } from '@/types/transcript';
import type { RecordingDebugInfo } from '@/types/recording';
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

function Wordmark({ eyebrow, recording = false }: { eyebrow: string; recording?: boolean }) {
  return (
    <View style={styles.wordmarkRow}>
      <View style={[styles.wordmarkMark, recording && styles.recordingMark]} />
      <Text style={styles.wordmark}>RECALL</Text>
      <Text style={styles.phaseMark}>{eyebrow}</Text>
    </View>
  );
}

function LiveAmplitude({ amplitude }: { amplitude: number }) {
  const bars = useMemo(
    () => Array.from({ length: 11 }, (_, index) => Math.max(0.2, amplitude * (0.6 + ((index * 17) % 5) / 10))),
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

function DevLiveDiagnostics({ debug }: { debug: RecordingDebugInfo }) {
  if (!__DEV__) {
    return null;
  }

  return (
    <View style={styles.devDiagnostics}>
      <Text style={styles.devDiagnosticsTitle}>DEV LIVE DIAGNOSTICS</Text>
      <Text style={styles.devDiagnosticsText}>
        {debug.connectionState} · token {debug.tokenFetched ? 'yes' : 'no'} · socket {debug.socketOpened ? 'open' : 'closed'} · setup {debug.setupComplete ? 'ready' : 'pending'}
      </Text>
      <Text style={styles.devDiagnosticsText}>
        sent {debug.audioChunksSent} · dropped {debug.droppedAudioChunks} · messages {debug.serverMessagesReceived} · interim {debug.interimTranscriptEvents} · final {debug.finalTranscriptEvents}
      </Text>
      {(debug.lastError || debug.lastCloseCode !== null || debug.setupTimedOut) && (
        <Text style={styles.devDiagnosticsError}>
          {debug.setupTimedOut ? 'setup timeout' : debug.lastError || `closed ${debug.lastCloseCode}`}
        </Text>
      )}
    </View>
  );
}

function IdleScreen({ phase, error, onStart }: { phase: string; error: string | null; onStart: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <Wordmark eyebrow="LOCAL CAPTURE" />
        <Text style={styles.pageTitle}>Hold on to the moment.</Text>
      </View>
      <View style={styles.introBlock}>
        <Text style={styles.introText}>
          A local-first recorder for the things worth remembering — lectures, conversations, ideas, and the space between them.
        </Text>
        <Text style={styles.languageNote}>MULTILINGUAL · LOCAL-FIRST · PRIVATE</Text>
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
      {error && <Text style={styles.errorText}>{error}</Text>}
    </ScrollView>
  );
}

function RecordingScreen({
  elapsedMs,
  connectionState,
  finalizedSegments,
  interimText,
  bookmarks,
  amplitude,
  debug,
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
  debug: RecordingDebugInfo;
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
        <Wordmark eyebrow="RECORDING" recording />
        <Text style={styles.timer}>{formatElapsedMs(elapsedMs)}</Text>
      </View>
      <View style={styles.liveStrip}>
        <LiveAmplitude amplitude={amplitude} />
        <View style={styles.connectionCopy}>
          <Text style={styles.connectionLabel}>{connectionLabel}</Text>
          <Text style={styles.connectionHint}>The local recording is the source of truth.</Text>
        </View>
      </View>
      <DevLiveDiagnostics debug={debug} />
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

function UnsavedCapture({ session, error, onReset }: {
  session: ReturnType<typeof useRecordingSession>['stoppedRecording'];
  error: string | null;
  onReset: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <Wordmark eyebrow="CAPTURE COMPLETE" />
        <Text style={styles.pageTitle}>Audio is safe.</Text>
      </View>
      <Text style={styles.helperText}>
        The recording could not be added to session history. The original local file was retained so it can be recovered.
      </Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
      <Text selectable style={styles.metaValuePath}>{session?.durableAudioUri || session?.recording?.fileUri || 'No local URI returned.'}</Text>
      <PressableButton label="Try another recording" onPress={onReset} />
    </ScrollView>
  );
}

export function RecordingFlow() {
  const router = useRouter();
  const session = useRecordingSession({
    onSessionCreated: (sessionId) => {
      router.replace({ pathname: '/session/[id]', params: { id: sessionId } } as never);
    },
  });

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
          debug={session.debug}
          error={session.error}
          onBookmark={session.addBookmark}
          onStop={session.stop}
        />
      </View>
    );
  }

  if (session.phase === 'stopped' && session.stoppedRecording && !session.stoppedRecording.sessionId) {
    return (
      <View style={styles.container}>
        <UnsavedCapture session={session.stoppedRecording} error={session.error} onReset={session.reset} />
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
  container: { flex: 1, backgroundColor: colors.background },
  screenContent: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  header: { gap: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wordmarkMark: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  recordingMark: { backgroundColor: colors.danger },
  wordmark: { color: colors.ink, fontSize: typography.eyebrow, fontWeight: '800', letterSpacing: 2 },
  phaseMark: { color: colors.faintInk, fontSize: typography.eyebrow, fontWeight: '600', letterSpacing: 1.1 },
  pageTitle: { maxWidth: 480, color: colors.ink, fontFamily: displayFont, fontSize: typography.display, fontWeight: '700', letterSpacing: -1.5, lineHeight: 60 },
  introBlock: { gap: spacing.lg, paddingBottom: spacing.xl },
  introText: { color: colors.ink, fontSize: typography.bodyLarge, lineHeight: 28, maxWidth: 560 },
  languageNote: { color: colors.accent, fontSize: typography.caption, fontWeight: '700', letterSpacing: 1.1 },
  rule: { height: 1, backgroundColor: colors.line },
  startBlock: { gap: spacing.lg, paddingTop: spacing.xl },
  helperText: { color: colors.mutedInk, fontSize: typography.body, lineHeight: 24 },
  button: { minHeight: layout.touchTarget, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButton: { backgroundColor: colors.ink },
  secondaryButton: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  dangerButton: { flex: 1, backgroundColor: colors.danger },
  buttonLabel: { color: colors.ink, fontSize: typography.body, fontWeight: '700' },
  primaryButtonLabel: { color: colors.white },
  dangerButtonLabel: { color: colors.white },
  disabledButton: { opacity: 0.55 },
  pressedButton: { opacity: 0.78 },
  errorText: { color: colors.danger, fontSize: typography.caption, lineHeight: 20 },
  recordingHeader: { gap: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  timer: { color: colors.ink, fontSize: typography.timer, fontWeight: '700', letterSpacing: 1.5, fontVariant: ['tabular-nums'] },
  liveStrip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  amplitude: { width: 130, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amplitudeBar: { width: 4, borderRadius: 2, backgroundColor: colors.accent },
  connectionCopy: { flex: 1, gap: spacing.xs },
  connectionLabel: { color: colors.ink, fontSize: typography.body, fontWeight: '700' },
  connectionHint: { color: colors.mutedInk, fontSize: typography.caption, lineHeight: 18 },
  transcriptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.md },
  sectionLabel: { color: colors.faintInk, fontSize: typography.eyebrow, fontWeight: '800', letterSpacing: 1.4 },
  segmentCount: { color: colors.mutedInk, fontSize: typography.caption },
  transcriptBlock: { gap: spacing.lg, paddingVertical: spacing.lg },
  transcriptLine: { flexDirection: 'row', gap: spacing.md },
  timestamp: { width: 42, paddingTop: 4, color: colors.accent, fontSize: typography.caption, fontWeight: '700', fontVariant: ['tabular-nums'] },
  transcriptText: { flex: 1, color: colors.ink, fontSize: typography.bodyLarge, lineHeight: 28 },
  interimLine: { opacity: 0.7 },
  interimText: { flex: 1, color: colors.mutedInk, fontSize: typography.bodyLarge, fontStyle: 'italic', lineHeight: 28 },
  emptyTranscript: { color: colors.mutedInk, fontSize: typography.body, lineHeight: 24 },
  recordingFooter: { gap: spacing.lg, borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg },
  bookmarkSummary: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  bookmarkCount: { color: colors.accent, fontFamily: displayFont, fontSize: typography.title, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  metaValuePath: { color: colors.mutedInk, fontSize: typography.caption, lineHeight: 20, marginVertical: spacing.lg },
  devDiagnostics: { gap: spacing.xs, marginTop: spacing.md, padding: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  devDiagnosticsTitle: { color: colors.faintInk, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  devDiagnosticsText: { color: colors.mutedInk, fontSize: 11, lineHeight: 17 },
  devDiagnosticsError: { color: colors.danger, fontSize: 11, lineHeight: 17 },
});

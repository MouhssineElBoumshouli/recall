import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, displayFont, layout, radii, spacing, typography } from '@/design/tokens';
import { useSessions } from '@/providers/SessionProvider';
import { getPreferredTranscript } from '@/services/transcriptPreference';
import type { RecallSession } from '@/types/session';
import { formatElapsedMs } from '@/utils/time';

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
    >
      <Text style={styles.primaryButtonLabel}>{label}</Text>
    </Pressable>
  );
}

function Wordmark() {
  return (
    <View style={styles.wordmarkRow}>
      <View style={styles.wordmarkMark} />
      <Text style={styles.wordmark}>RECALL</Text>
      <Text style={styles.eyebrow}>LOCAL MEMORY</Text>
    </View>
  );
}

function SessionRow({ session, onPress }: { session: RecallSession; onPress: () => void }) {
  const preferredTranscript = getPreferredTranscript(session);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${session.title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.sessionRow, pressed && styles.pressedRow]}
    >
      <View style={styles.sessionCopy}>
        <Text numberOfLines={1} style={styles.sessionTitle}>{session.title}</Text>
        <Text style={styles.sessionMeta}>
          {new Date(session.recordedAt).toLocaleString()} · {formatElapsedMs(session.durationMs)}
        </Text>
        <Text style={styles.sessionStatus}>
          {session.transcriptStatus === 'processing' ? 'Processing transcript…' :
            session.transcriptStatus === 'failed' ? 'Transcript processing needs attention' :
              preferredTranscript.text ? 'Transcript saved' : 'Audio saved'}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { sessions, loading, error } = useSessions();

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <Wordmark />
        <Text style={styles.pageTitle}>Keep the thought.</Text>
        <Text style={styles.introText}>
          A quiet place for lectures, conversations, ideas, and everything worth returning to.
        </Text>
      </View>

      <PrimaryButton label="New recording" onPress={() => router.push('/record' as never)} />

      <View style={styles.historyHeader}>
        <Text style={styles.sectionLabel}>RECENT SESSIONS</Text>
        {sessions.length > 0 && <Text style={styles.count}>{sessions.length}</Text>}
      </View>

      {loading && <Text style={styles.helperText}>Loading saved sessions…</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}
      {!loading && !error && sessions.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Nothing here yet.</Text>
          <Text style={styles.helperText}>Your recordings will stay on this device and appear here after you stop.</Text>
        </View>
      )}
      {!loading && sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          onPress={() => router.push({ pathname: '/session/[id]', params: { id: session.id } } as never)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  wordmark: { color: colors.ink, fontSize: typography.eyebrow, fontWeight: '800', letterSpacing: 2 },
  eyebrow: { color: colors.faintInk, fontSize: typography.eyebrow, fontWeight: '600', letterSpacing: 1.1 },
  pageTitle: { color: colors.ink, fontFamily: displayFont, fontSize: typography.display, fontWeight: '700', letterSpacing: -1.5, lineHeight: 60 },
  introText: { color: colors.ink, fontSize: typography.bodyLarge, lineHeight: 28, maxWidth: 560 },
  primaryButton: { minHeight: layout.touchTarget, borderRadius: radii.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButtonLabel: { color: colors.white, fontSize: typography.body, fontWeight: '700' },
  pressed: { opacity: 0.78 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.md },
  sectionLabel: { color: colors.faintInk, fontSize: typography.eyebrow, fontWeight: '800', letterSpacing: 1.4 },
  count: { color: colors.mutedInk, fontSize: typography.caption },
  sessionRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderColor: colors.line, paddingVertical: spacing.md },
  pressedRow: { opacity: 0.72 },
  sessionCopy: { flex: 1, gap: spacing.xs },
  sessionTitle: { color: colors.ink, fontSize: typography.bodyLarge, fontWeight: '700' },
  sessionMeta: { color: colors.mutedInk, fontSize: typography.caption },
  sessionStatus: { color: colors.accent, fontSize: typography.caption, fontWeight: '600' },
  chevron: { color: colors.accent, fontFamily: displayFont, fontSize: 30, paddingLeft: spacing.md },
  emptyState: { gap: spacing.sm, borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg },
  emptyTitle: { color: colors.ink, fontFamily: displayFont, fontSize: typography.title, fontWeight: '700' },
  helperText: { color: colors.mutedInk, fontSize: typography.body, lineHeight: 24 },
  errorText: { color: colors.danger, fontSize: typography.caption, lineHeight: 20 },
});

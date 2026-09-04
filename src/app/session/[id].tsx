import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { colors, displayFont, layout, radii, spacing, typography } from '@/design/tokens';
import { isAudioFileAvailable } from '@/services/sessionAudioStorage';
import { useSessions } from '@/providers/SessionProvider';
import type { RecallSessionWithBookmarks } from '@/types/session';
import { formatElapsedMs } from '@/utils/time';

function ActionButton({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, danger && styles.dangerButton, pressed && styles.pressed]}
    >
      <Text style={[styles.actionButtonLabel, danger && styles.dangerButtonLabel]}>{label}</Text>
    </Pressable>
  );
}

function StatusText({ session }: { session: RecallSessionWithBookmarks }) {
  const { transcriptStatus, processingError } = session.session;
  if (transcriptStatus === 'processing') {
    return <Text style={styles.statusText}>Processing transcript…</Text>;
  }
  if (transcriptStatus === 'failed') {
    return <Text style={styles.errorText}>{processingError || 'Transcript processing needs attention.'}</Text>;
  }
  return <Text style={styles.statusText}>Transcript saved locally</Text>;
}

export default function SessionDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { sessions, getSession, renameSession, deleteSession } = useSessions();
  const [detail, setDetail] = useState<RecallSessionWithBookmarks | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const player = useAudioPlayer(detail?.session.audioUri);
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    let active = true;
    if (!id) {
      return undefined;
    }

    void getSession(id)
      .then((nextDetail) => {
        if (!active) {
          return;
        }
        setDetail(nextDetail);
        setTitleDraft(nextDetail?.session.title || '');
        setError(nextDetail ? null : 'This saved session could not be found.');
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load this session.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [getSession, id, sessions]);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    return () => {
      player.pause();
    };
  }, [player]);

  const audioAvailable = useMemo(
    () => Boolean(detail && isAudioFileAvailable(detail.session.audioUri)),
    [detail],
  );
  const totalSeconds = playerStatus.duration > 0 ? playerStatus.duration : (detail?.session.durationMs || 0) / 1_000;
  const currentSeconds = Math.min(playerStatus.currentTime, totalSeconds || playerStatus.currentTime);

  const seekToRatio = (ratio: number) => {
    if (totalSeconds <= 0) {
      return;
    }
    player.seekTo(Math.max(0, Math.min(totalSeconds, ratio * totalSeconds)));
  };

  const handleSaveTitle = async () => {
    if (!id || !titleDraft.trim() || savingTitle) {
      return;
    }
    setSavingTitle(true);
    try {
      await renameSession(id, titleDraft);
      setEditingTitle(false);
      setError(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Unable to rename this session.');
    } finally {
      setSavingTitle(false);
    }
  };

  const confirmDelete = () => {
    if (!id || deleting) {
      return;
    }
    Alert.alert('Delete this session?', 'The saved audio, transcript, and bookmarks will be removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setDeleting(true);
          void deleteSession(id)
            .then(() => router.replace('/'))
            .catch((deleteError) => {
              setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete this session.');
            })
            .finally(() => setDeleting(false));
        },
      },
    ]);
  };

  if (loading) {
    return <View style={styles.centered}><Text style={styles.helperText}>Loading session…</Text></View>;
  }
  if (!id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>This session link is missing an identifier.</Text>
        <ActionButton label="Back to history" onPress={() => router.replace('/')} />
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || 'Session not found.'}</Text>
        <ActionButton label="Back to history" onPress={() => router.replace('/')} />
      </View>
    );
  }

  const { session, bookmarks } = detail;
  const transcript = session.authoritativeTranscript || session.liveTranscript;

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to history" onPress={() => router.replace('/')}>
          <Text style={styles.backLabel}>‹ HISTORY</Text>
        </Pressable>
        <Text style={styles.eyebrow}>SESSION</Text>
      </View>

      <View style={styles.header}>
        {editingTitle ? (
          <View style={styles.titleEditor}>
            <TextInput
              accessibilityLabel="Session title"
              autoFocus
              onChangeText={setTitleDraft}
              onSubmitEditing={() => void handleSaveTitle()}
              placeholder="Session title"
              placeholderTextColor={colors.faintInk}
              style={styles.titleInput}
              value={titleDraft}
            />
            <ActionButton label={savingTitle ? 'Saving…' : 'Save title'} onPress={() => void handleSaveTitle()} />
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Rename session" onPress={() => setEditingTitle(true)}>
            <Text style={styles.pageTitle}>{session.title}</Text>
          </Pressable>
        )}
        <Text style={styles.metaText}>
          {new Date(session.recordedAt).toLocaleString()} · {formatElapsedMs(session.durationMs)}
        </Text>
        <StatusText session={detail} />
      </View>

      <View style={styles.playerBlock}>
        <View style={styles.playerControls}>
          <ActionButton
            label={playerStatus.playing ? 'Pause' : 'Play'}
            onPress={() => {
              if (!audioAvailable) {
                setError('The saved audio file is missing from this device.');
                return;
              }
              if (playerStatus.playing) {
                player.pause();
              } else {
                player.play();
              }
            }}
          />
          <Text style={styles.playerTime}>{formatElapsedMs(currentSeconds * 1_000)} / {formatElapsedMs(totalSeconds * 1_000)}</Text>
        </View>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Audio timeline"
          onLayout={(event) => setTimelineWidth(event.nativeEvent.layout.width)}
          onPress={(event) => {
            if (timelineWidth > 0) {
              seekToRatio(event.nativeEvent.locationX / timelineWidth);
            }
          }}
          style={styles.timeline}
        >
          <View style={[styles.timelineProgress, { width: `${totalSeconds ? (currentSeconds / totalSeconds) * 100 : 0}%` }]} />
        </Pressable>
        {!audioAvailable && <Text style={styles.errorText}>Saved audio file is unavailable for playback.</Text>}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>TRANSCRIPT</Text>
        <Text style={styles.sourceLabel}>{session.authoritativeTranscriptSource.replace('-', ' ')}</Text>
      </View>
      <View style={styles.transcriptBlock}>
        {transcript ? <Text style={styles.transcriptText}>{transcript}</Text> : <Text style={styles.helperText}>No transcript was captured.</Text>}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>BOOKMARKS</Text>
        <Text style={styles.sourceLabel}>{bookmarks.length}</Text>
      </View>
      <View style={styles.bookmarksBlock}>
        {bookmarks.length === 0 && <Text style={styles.helperText}>No bookmarks in this session.</Text>}
        {bookmarks.map((bookmark) => (
          <Pressable
            key={bookmark.id}
            accessibilityRole="button"
            accessibilityLabel={`Seek to bookmark at ${formatElapsedMs(bookmark.elapsedTimestampMs)}`}
            onPress={() => {
              if (!audioAvailable) {
                setError('Saved audio file is unavailable for seeking.');
                return;
              }
              player.seekTo(bookmark.elapsedTimestampMs / 1_000);
            }}
            style={styles.bookmarkRow}
          >
            <Text style={styles.bookmarkTime}>{formatElapsedMs(bookmark.elapsedTimestampMs)}</Text>
            <Text style={styles.bookmarkHint}>Jump to moment</Text>
          </Pressable>
        ))}
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}
      <ActionButton label={deleting ? 'Deleting…' : 'Delete session'} onPress={confirmDelete} danger />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, backgroundColor: colors.background, padding: spacing.lg },
  screenContent: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: spacing.xl },
  backLabel: { color: colors.accent, fontSize: typography.eyebrow, fontWeight: '800', letterSpacing: 1.1 },
  eyebrow: { color: colors.faintInk, fontSize: typography.eyebrow, fontWeight: '700', letterSpacing: 1.2 },
  header: { gap: spacing.md, paddingBottom: spacing.xl },
  pageTitle: { color: colors.ink, fontFamily: displayFont, fontSize: typography.display, fontWeight: '700', letterSpacing: -1.5, lineHeight: 58 },
  titleEditor: { gap: spacing.md },
  titleInput: { color: colors.ink, borderBottomWidth: 1, borderColor: colors.accent, fontFamily: displayFont, fontSize: typography.title, paddingVertical: spacing.sm },
  metaText: { color: colors.mutedInk, fontSize: typography.body },
  statusText: { color: colors.accent, fontSize: typography.caption, fontWeight: '700' },
  errorText: { color: colors.danger, fontSize: typography.caption, lineHeight: 20 },
  playerBlock: { gap: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: spacing.lg },
  playerControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actionButton: { minHeight: layout.touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.ink, paddingHorizontal: spacing.lg },
  actionButtonLabel: { color: colors.white, fontSize: typography.body, fontWeight: '700' },
  dangerButton: { backgroundColor: colors.danger, marginTop: spacing.xl },
  dangerButtonLabel: { color: colors.white },
  pressed: { opacity: 0.75 },
  playerTime: { color: colors.mutedInk, fontSize: typography.caption, fontVariant: ['tabular-nums'] },
  timeline: { height: 16, justifyContent: 'center', overflow: 'hidden', borderRadius: 8, backgroundColor: colors.line },
  timelineProgress: { height: 16, borderRadius: 8, backgroundColor: colors.accent },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.md },
  sectionLabel: { color: colors.faintInk, fontSize: typography.eyebrow, fontWeight: '800', letterSpacing: 1.4 },
  sourceLabel: { color: colors.mutedInk, fontSize: typography.caption },
  transcriptBlock: { paddingVertical: spacing.lg },
  transcriptText: { color: colors.ink, fontSize: typography.bodyLarge, lineHeight: 30 },
  helperText: { color: colors.mutedInk, fontSize: typography.body, lineHeight: 24, textAlign: 'center' },
  bookmarksBlock: { borderTopWidth: 1, borderColor: colors.line },
  bookmarkRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderColor: colors.line },
  bookmarkTime: { color: colors.accent, fontSize: typography.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bookmarkHint: { color: colors.mutedInk, fontSize: typography.body },
});

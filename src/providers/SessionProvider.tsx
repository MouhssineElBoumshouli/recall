import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, displayFont, layout, radii, spacing, typography } from '@/design/tokens';
import { tokenServerUrl } from '@/config';
import { deleteSessionAudio } from '@/services/sessionAudioStorage';
import { getSessionRepository } from '@/services/sqliteSessionRepository';
import { loadSessionSnapshot } from '@/services/sessionSnapshot';
import { SessionIntelligenceClient } from '@/services/sessionIntelligenceClient';
import { createSessionIntelligenceRunGate, runSessionIntelligence } from '@/services/sessionIntelligenceWorkflow';
import type { SessionRepository } from '@/services/sessionRepository';
import type {
  RecallSession,
  RecallSessionWithBookmarks,
  SessionBookmark,
  SessionTranscriptUpdate,
} from '@/types/session';

interface SessionContextValue {
  sessions: RecallSession[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getSession: (id: string) => Promise<RecallSessionWithBookmarks | null>;
  generateIntelligence: (id: string) => Promise<void>;
  createSession: (session: RecallSession, bookmarks: SessionBookmark[]) => Promise<void>;
  updateSession: (id: string, update: SessionTranscriptUpdate) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function StartupScreen({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const failed = Boolean(error);
  return (
    <View style={styles.startupScreen}>
      <View style={styles.wordmarkRow}>
        <View style={styles.wordmarkMark} />
        <Text style={styles.wordmark}>RECALL</Text>
      </View>
      <Text style={styles.startupTitle}>{failed ? 'Your sessions are still here.' : 'Opening your sessions…'}</Text>
      <Text style={styles.startupMessage}>
        {failed ? 'Recall could not open local session storage.' : 'Loading local memory from this device.'}
      </Text>
      {failed && (
        <>
          {__DEV__ && error && <Text style={styles.startupDetail}>{error}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Retry opening sessions" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<RecallSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const repositoryRef = useRef<SessionRepository | null>(null);
  const initializationRef = useRef<Promise<SessionRepository> | null>(null);
  const intelligenceRunGateRef = useRef(createSessionIntelligenceRunGate());
  const [intelligenceClient] = useState(() => new SessionIntelligenceClient(tokenServerUrl));
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const getReadyRepository = useCallback(async () => {
    if (repositoryRef.current) {
      return repositoryRef.current;
    }

    if (!initializationRef.current) {
      initializationRef.current = getSessionRepository().then(async (nextRepository) => {
        await nextRepository.initialize();
        return nextRepository;
      }).catch((initializationError) => {
        initializationRef.current = null;
        throw initializationError;
      });
    }

    const nextRepository = await initializationRef.current;
    repositoryRef.current = nextRepository;
    return nextRepository;
  }, []);

  const refresh = useCallback(async () => {
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const nextRepository = await getReadyRepository();
      const nextSessions = await loadSessionSnapshot(nextRepository);
      if (mountedRef.current) {
        setSessions(nextSessions);
      }
    } catch (refreshError) {
      if (mountedRef.current) {
        const message = errorMessage(refreshError, 'Unable to load saved sessions.');
        setError(message);
        if (__DEV__) {
          console.error('[Recall] local session initialization failed:', message);
        }
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [getReadyRepository]);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const getSession = useCallback(async (id: string) => {
    const nextRepository = await getReadyRepository();
    return nextRepository.getSession(id);
  }, [getReadyRepository]);

  const generateIntelligence = useCallback(async (id: string) => {
    await intelligenceRunGateRef.current.run(id, async () => {
      const nextRepository = await getReadyRepository();
      await runSessionIntelligence(id, nextRepository, intelligenceClient);
      if (mountedRef.current) {
        setSessions(await nextRepository.listSessions());
      }
    });
  }, [getReadyRepository, intelligenceClient]);

  const createSession = useCallback(async (session: RecallSession, bookmarks: SessionBookmark[]) => {
    const nextRepository = await getReadyRepository();
    await nextRepository.createSession(session, bookmarks);
    if (mountedRef.current) {
      setSessions(await nextRepository.listSessions());
      setError(null);
    }
  }, [getReadyRepository]);

  const updateSession = useCallback(async (id: string, update: SessionTranscriptUpdate) => {
    const nextRepository = await getReadyRepository();
    await nextRepository.updateSession(id, update);
    if (mountedRef.current) {
      setSessions(await nextRepository.listSessions());
    }
  }, [getReadyRepository]);

  const renameSession = useCallback(async (id: string, title: string) => {
    const nextRepository = await getReadyRepository();
    await nextRepository.renameSession(id, title);
    if (mountedRef.current) {
      setSessions(await nextRepository.listSessions());
    }
  }, [getReadyRepository]);

  const deleteSession = useCallback(async (id: string) => {
    const nextRepository = await getReadyRepository();
    await nextRepository.deleteSession(id);
    try {
      deleteSessionAudio(id);
    } catch (audioError) {
      await refresh();
      throw new Error(`Session metadata was deleted, but its audio could not be cleaned up: ${errorMessage(audioError, 'unknown local file error')}`);
    }
    if (mountedRef.current) {
      setSessions(await nextRepository.listSessions());
    }
  }, [getReadyRepository, refresh]);

  const value = useMemo<SessionContextValue>(() => ({
    sessions,
    loading,
    error,
    refresh,
    getSession,
    generateIntelligence,
    createSession,
    updateSession,
    renameSession,
    deleteSession,
  }), [
    sessions,
    loading,
    error,
    refresh,
    getSession,
    generateIntelligence,
    createSession,
    updateSession,
    renameSession,
    deleteSession,
  ]);

  return (
    <SessionContext.Provider value={value}>
      {loading || error ? <StartupScreen error={error} onRetry={() => void refresh()} /> : children}
    </SessionContext.Provider>
  );
}

export function useSessions(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessions must be used inside SessionProvider.');
  }
  return context;
}

const styles = StyleSheet.create({
  startupScreen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wordmarkMark: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  wordmark: { color: colors.ink, fontSize: typography.eyebrow, fontWeight: '800', letterSpacing: 2 },
  startupTitle: { color: colors.ink, fontFamily: displayFont, fontSize: typography.title, fontWeight: '700', maxWidth: layout.maxContentWidth },
  startupMessage: { color: colors.mutedInk, fontSize: typography.body, lineHeight: 24, maxWidth: layout.maxContentWidth },
  startupDetail: { color: colors.danger, fontSize: typography.caption, lineHeight: 20, maxWidth: layout.maxContentWidth },
  retryButton: { minHeight: layout.touchTarget, borderRadius: radii.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  retryLabel: { color: colors.white, fontSize: typography.body, fontWeight: '700' },
});

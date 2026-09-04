import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { deleteSessionAudio } from '@/services/sessionAudioStorage';
import { getSessionRepository } from '@/services/sqliteSessionRepository';
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
  createSession: (session: RecallSession, bookmarks: SessionBookmark[]) => Promise<void>;
  updateSession: (id: string, update: SessionTranscriptUpdate) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [repository, setRepository] = useState<SessionRepository | null>(null);
  const [sessions, setSessions] = useState<RecallSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextRepository = repository || await getSessionRepository();
      await nextRepository.initialize();
      const nextSessions = await nextRepository.listSessions();
      setRepository(nextRepository);
      setSessions(nextSessions);
      setError(null);
    } catch (refreshError) {
      setError(errorMessage(refreshError, 'Unable to load saved sessions.'));
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const getReadyRepository = useCallback(async () => {
    const nextRepository = repository || await getSessionRepository();
    await nextRepository.initialize();
    if (!repository) {
      setRepository(nextRepository);
    }
    return nextRepository;
  }, [repository]);

  const getSession = useCallback(async (id: string) => {
    const nextRepository = await getReadyRepository();
    return nextRepository.getSession(id);
  }, [getReadyRepository]);

  const createSession = useCallback(async (session: RecallSession, bookmarks: SessionBookmark[]) => {
    const nextRepository = await getReadyRepository();
    await nextRepository.createSession(session, bookmarks);
    setSessions(await nextRepository.listSessions());
    setError(null);
  }, [getReadyRepository]);

  const updateSession = useCallback(async (id: string, update: SessionTranscriptUpdate) => {
    const nextRepository = await getReadyRepository();
    await nextRepository.updateSession(id, update);
    setSessions(await nextRepository.listSessions());
  }, [getReadyRepository]);

  const renameSession = useCallback(async (id: string, title: string) => {
    const nextRepository = await getReadyRepository();
    await nextRepository.renameSession(id, title);
    setSessions(await nextRepository.listSessions());
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
    setSessions(await nextRepository.listSessions());
  }, [getReadyRepository, refresh]);

  const value = useMemo<SessionContextValue>(() => ({
    sessions,
    loading,
    error,
    refresh,
    getSession,
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
    createSession,
    updateSession,
    renameSession,
    deleteSession,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessions(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessions must be used inside SessionProvider.');
  }
  return context;
}

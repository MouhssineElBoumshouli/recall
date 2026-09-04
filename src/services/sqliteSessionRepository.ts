import { openDatabaseAsync, type SQLiteBindValue } from 'expo-sqlite';

import {
  createSessionRepository,
  type SessionDatabase,
  type SessionRepository,
} from '@/services/sessionRepository';

let repositoryPromise: Promise<SessionRepository> | null = null;

export function getSessionRepository(): Promise<SessionRepository> {
  if (!repositoryPromise) {
    repositoryPromise = openDatabaseAsync('recall.db').then((database) => {
      const adapter: SessionDatabase = {
        execAsync: (source) => database.execAsync(source),
        runAsync: (source, params = []) => database.runAsync(source, params as SQLiteBindValue[]),
        getFirstAsync: <T>(source: string, params: SQLiteBindValue[] = []) =>
          database.getFirstAsync<T>(source, params),
        getAllAsync: <T>(source: string, params: SQLiteBindValue[] = []) =>
          database.getAllAsync<T>(source, params),
        withTransactionAsync: (task) => database.withTransactionAsync(task),
      };
      return createSessionRepository(adapter);
    });
  }

  return repositoryPromise;
}


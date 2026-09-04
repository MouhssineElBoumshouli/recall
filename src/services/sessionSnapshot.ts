import type { RecallSession } from '@/types/session';
import type { SessionRepository } from '@/services/sessionRepository';

/**
 * Loads the local session snapshot after ensuring the schema is ready.
 * Keeping this sequence together prevents startup from exposing a partially
 * initialized repository to the home screen.
 */
export async function loadSessionSnapshot(repository: SessionRepository): Promise<RecallSession[]> {
  await repository.initialize();
  return repository.listSessions();
}

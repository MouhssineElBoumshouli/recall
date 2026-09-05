import { describe, expect, it, vi } from 'vitest';

import { loadSessionSnapshot } from '@/services/sessionSnapshot';
import type { SessionRepository } from '@/services/sessionRepository';

function repository(overrides: Partial<SessionRepository> = {}): SessionRepository {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
    getIntelligence: vi.fn().mockResolvedValue({}),
    updateIntelligence: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(undefined),
    updateSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('session startup snapshot', () => {
  it('initializes the repository before loading saved sessions', async () => {
    const calls: string[] = [];
    const localRepository = repository({
      initialize: vi.fn().mockImplementation(async () => {
        calls.push('initialize');
      }),
      listSessions: vi.fn().mockImplementation(async () => {
        calls.push('list');
        return [];
      }),
    });

    await expect(loadSessionSnapshot(localRepository)).resolves.toEqual([]);
    expect(calls).toEqual(['initialize', 'list']);
  });

  it('surfaces initialization failures for the provider error state', async () => {
    const localRepository = repository({
      initialize: vi.fn().mockRejectedValue(new Error('database migration failed')),
    });

    await expect(loadSessionSnapshot(localRepository)).rejects.toThrow('database migration failed');
    expect(localRepository.listSessions).not.toHaveBeenCalled();
  });
});

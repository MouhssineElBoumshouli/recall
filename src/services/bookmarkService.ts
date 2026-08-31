import type { Bookmark } from '@/types/bookmark';

export function createBookmark(elapsedTimestampMs: number, createdAt = new Date()): Bookmark {
  return {
    id: `bookmark-${createdAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    elapsedTimestampMs: Math.max(0, Math.round(elapsedTimestampMs)),
    createdAt: createdAt.toISOString(),
  };
}

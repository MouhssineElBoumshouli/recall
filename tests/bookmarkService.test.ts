import { describe, expect, it } from 'vitest';

import { createBookmark } from '@/services/bookmarkService';

describe('bookmark creation', () => {
  it('creates a timestamped bookmark with a stable ISO creation time', () => {
    const createdAt = new Date('2026-08-31T12:00:00.000Z');
    const bookmark = createBookmark(12_345.6, createdAt);

    expect(bookmark).toMatchObject({
      elapsedTimestampMs: 12_346,
      createdAt: '2026-08-31T12:00:00.000Z',
    });
    expect(bookmark.id).toMatch(/^bookmark-1788177600000-/);
  });
});

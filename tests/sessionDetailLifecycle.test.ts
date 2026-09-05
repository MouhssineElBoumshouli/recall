import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sessionDetailSource = readFileSync(
  fileURLToPath(new URL('../src/app/session/[id].tsx', import.meta.url)),
  'utf8',
);

describe('session detail audio lifecycle contract', () => {
  it('does not manually pause the hook-owned player during unmount', () => {
    expect(sessionDetailSource).not.toMatch(/return\s*\(\)\s*=>\s*\{\s*player\.pause\(\);/);
  });

  it('keeps the player unloaded until a valid session audio URI is available', () => {
    expect(sessionDetailSource).toContain('useAudioPlayer(detail?.session.audioUri ?? null)');
  });

  it('keeps playback cleanup independent from delete navigation', () => {
    expect(sessionDetailSource).toContain(".then(() => router.replace('/'))");
    expect(sessionDetailSource).not.toContain('deleteSession(id).then(() => player.pause());');
  });

  it('renders the intelligence processing, failure, and empty-transcript states', () => {
    expect(sessionDetailSource).toContain('Generating notes…');
    expect(sessionDetailSource).toContain('Notes could not be generated.');
    expect(sessionDetailSource).toContain('Not enough transcript to generate notes.');
    expect(sessionDetailSource).toContain('generateIntelligence(id)');
  });
});

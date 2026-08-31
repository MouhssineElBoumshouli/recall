import { describe, expect, it } from 'vitest';

import { __private__ } from '@/services/geminiLiveTranscription';

describe('Gemini Live message parsing', () => {
  it('parses interim input transcription separately from finalized input transcription', () => {
    expect(
      __private__.parseTranscriptMessage(
        JSON.stringify({
          serverContent: {
            interimInputTranscription: { text: 'Bonjour tout' },
          },
          eventId: 'interim-1',
        }),
      ),
    ).toEqual({
      kind: 'interim',
      text: 'Bonjour tout',
      sourceId: 'interim-1',
    });

    expect(
      __private__.parseTranscriptMessage(
        JSON.stringify({
          server_content: {
            input_transcription: { text: 'Bonjour tout le monde.' },
          },
          event_id: 'final-1',
        }),
      ),
    ).toEqual({
      kind: 'final',
      text: 'Bonjour tout le monde.',
      sourceId: 'final-1',
    });
  });

  it('ignores malformed and non-transcription messages', () => {
    expect(__private__.parseTranscriptMessage('{not-json')).toBeNull();
    expect(__private__.parseTranscriptMessage(JSON.stringify({ setupComplete: true }))).toBeNull();
    expect(
      __private__.parseTranscriptMessage(
        JSON.stringify({ serverContent: { inputTranscription: { text: '   ' } } }),
      ),
    ).toBeNull();
  });
});

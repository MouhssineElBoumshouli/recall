import { describe, expect, it, vi } from 'vitest';

import {
  buildSessionIntelligenceInstruction,
  createGeminiSessionIntelligenceProvider,
  parseSessionIntelligenceContent,
  SessionIntelligenceProviderError,
} from '../server/sessionIntelligenceService';
import type { GoogleGenAI } from '@google/genai';

const validContent = {
  summary: 'A concise summary.',
  keyPoints: ['The first point.'],
  actionItems: [{ text: 'Send the document.', owner: null, dueDate: null }],
  chapters: [{ title: 'Opening topic', summary: 'The topic was introduced.', startTimestampMs: null }],
};

describe('session intelligence provider', () => {
  it('builds a generic grounded instruction without country or language requirements', () => {
    const instruction = buildSessionIntelligenceInstruction('The session transcript.');

    expect(instruction).toContain('Use only information explicitly supported by the transcript.');
    expect(instruction).toContain('Do not invent facts, decisions, names, dates, tasks, owners, due dates, or commitments.');
    expect(instruction).toContain('Do not translate everything into English by default.');
    expect(instruction).toContain('preserving meaningful multilingual terms and natural code-switching');
    expect(instruction).not.toMatch(/Moroccan|Darija|Arabic|French|Morocco/i);
  });

  it('adds optional language context as advisory metadata', () => {
    const instruction = buildSessionIntelligenceInstruction('Transcript.', {
      likelyLanguages: ['Spanish', 'English'],
      localeHints: ['Mexico'],
      preserveCodeSwitching: true,
    });

    expect(instruction).toContain('Likely languages: Spanish, English.');
    expect(instruction).toContain('Locale hints: Mexico.');
    expect(instruction).toContain('These hints must not cause the model to invent a language');
  });

  it('parses the structured response and rejects malformed output safely', () => {
    expect(parseSessionIntelligenceContent(JSON.stringify(validContent))).toEqual(validContent);
    expect(() => parseSessionIntelligenceContent('{not json')).toThrow(SessionIntelligenceProviderError);
    expect(() => parseSessionIntelligenceContent(JSON.stringify({ summary: 'Only summary' }))).toThrow('incomplete structured response');
  });

  it('uses the installed Gemini model with structured JSON output', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify(validContent) });
    const ai = {
      interactions: { create },
    } as unknown as GoogleGenAI;
    const provider = createGeminiSessionIntelligenceProvider(ai);

    await expect(provider.generate({
      preferredTranscript: 'Preferred transcript.',
      languageContext: null,
    })).resolves.toEqual(validContent);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash-lite',
      input: expect.stringContaining('PREFERRED TRANSCRIPT:\nPreferred transcript.'),
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: expect.objectContaining({
          type: 'object',
          required: ['summary', 'keyPoints', 'actionItems', 'chapters'],
        }),
      },
    }));
  });

  it('returns a safe provider error without exposing the underlying message', async () => {
    const create = vi.fn().mockRejectedValue(new Error('sensitive-provider-details'));
    const ai = { interactions: { create } } as unknown as GoogleGenAI;
    const provider = createGeminiSessionIntelligenceProvider(ai);

    await expect(provider.generate({ preferredTranscript: 'Transcript.', languageContext: null })).rejects.toMatchObject({
      name: 'SessionIntelligenceProviderError',
      code: 'INTELLIGENCE_PROVIDER_FAILED',
      message: 'The intelligence provider could not generate session notes.',
    });
  });
});

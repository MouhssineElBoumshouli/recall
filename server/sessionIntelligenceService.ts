import type { GoogleGenAI } from '@google/genai';

import type {
  SessionIntelligenceContent,
  SessionIntelligenceGenerationInput,
} from '../src/types/intelligence.js';
import type { TranscriptLanguageContext } from '../src/types/languageContext.js';

export const SESSION_INTELLIGENCE_MODEL = 'gemini-3.5-flash-lite';

export interface SessionIntelligenceProvider {
  generate(input: SessionIntelligenceGenerationInput): Promise<SessionIntelligenceContent>;
}

export type SessionIntelligenceErrorCode =
  | 'INTELLIGENCE_PROVIDER_FAILED'
  | 'INTELLIGENCE_INVALID_RESPONSE';

export class SessionIntelligenceProviderError extends Error {
  readonly code: SessionIntelligenceErrorCode;

  constructor(code: SessionIntelligenceErrorCode, message: string) {
    super(message);
    this.name = 'SessionIntelligenceProviderError';
    this.code = code;
  }
}

const SESSION_INTELLIGENCE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'A concise factual summary in the dominant language of the session when practical.',
    },
    keyPoints: {
      type: 'array',
      items: { type: 'string' },
      description: 'Important facts, ideas, decisions, arguments, or concepts grounded in the transcript.',
    },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          owner: { type: ['string', 'null'] },
          dueDate: { type: ['string', 'null'] },
        },
        required: ['text', 'owner', 'dueDate'],
        additionalProperties: false,
      },
      description: 'Only explicit or strongly implied tasks; use an empty array when there are none.',
    },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          startTimestampMs: { type: ['integer', 'null'] },
        },
        required: ['title', 'summary', 'startTimestampMs'],
        additionalProperties: false,
      },
      description: 'Logical topical sections. Use null timestamps unless reliable alignment exists.',
    },
  },
  required: ['summary', 'keyPoints', 'actionItems', 'chapters'],
  additionalProperties: false,
} as const;

function contextInstruction(languageContext: TranscriptLanguageContext | null): string {
  const likelyLanguages = languageContext?.likelyLanguages?.filter(Boolean) || [];
  const localeHints = languageContext?.localeHints?.filter(Boolean) || [];
  const preserveCodeSwitching = languageContext?.preserveCodeSwitching !== false;

  if (likelyLanguages.length === 0 && localeHints.length === 0 && preserveCodeSwitching) {
    return 'No language context was provided. Detect and preserve the languages and code-switching present in the transcript.';
  }

  const lines = ['Additional session context (advisory only):'];
  if (likelyLanguages.length > 0) {
    lines.push(`Likely languages: ${likelyLanguages.join(', ')}.`);
  }
  if (localeHints.length > 0) {
    lines.push(`Locale hints: ${localeHints.join(', ')}.`);
  }
  if (preserveCodeSwitching) {
    lines.push('The speaker may switch languages without warning; preserve that meaning in the generated text.');
  }
  lines.push('These hints must not cause the model to invent a language, fact, or meaning unsupported by the transcript.');
  return lines.join('\n');
}

export function buildSessionIntelligenceInstruction(
  preferredTranscript: string,
  languageContext: TranscriptLanguageContext | null = null,
): string {
  return [
    'Generate structured session intelligence from the transcript below.',
    'Use only information explicitly supported by the transcript.',
    'Do not invent facts, decisions, names, dates, tasks, owners, due dates, or commitments.',
    'Omit uncertain content instead of fabricating it.',
    'Do not silently correct factual transcript mistakes.',
    'Write a concise factual summary.',
    'Extract important facts, ideas, decisions, arguments, or concepts as key points.',
    'Include action items only when they are explicit or strongly implied; otherwise return an empty list.',
    'Group the discussion into logical topical chapters. Do not fabricate chapter timestamps; use null unless reliable timing is present in the transcript.',
    'Prefer the dominant language of the session for user-facing output when practical, while preserving meaningful multilingual terms and natural code-switching.',
    'Do not translate everything into English by default.',
    contextInstruction(languageContext),
    'Return only the requested JSON structure.',
    '',
    'PREFERRED TRANSCRIPT:',
    preferredTranscript,
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseSessionIntelligenceContent(outputText: string): SessionIntelligenceContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new SessionIntelligenceProviderError(
      'INTELLIGENCE_INVALID_RESPONSE',
      'The intelligence provider returned malformed structured output.',
    );
  }

  if (!isRecord(parsed)) {
    throw new SessionIntelligenceProviderError(
      'INTELLIGENCE_INVALID_RESPONSE',
      'The intelligence provider returned an invalid structured response.',
    );
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : null;
  const keyPoints = Array.isArray(parsed.keyPoints)
    ? parsed.keyPoints.map(cleanText).filter((item): item is string => Boolean(item))
    : null;
  const actionItems = Array.isArray(parsed.actionItems) ? parsed.actionItems.map((item) => {
    if (!isRecord(item)) {
      return null;
    }
    const text = cleanText(item.text);
    const owner = item.owner === null ? null : cleanText(item.owner);
    const dueDate = item.dueDate === null ? null : cleanText(item.dueDate);
    return text ? { text, owner, dueDate } : null;
  }).filter((item): item is SessionIntelligenceContent['actionItems'][number] => Boolean(item)) : null;
  const chapters = Array.isArray(parsed.chapters) ? parsed.chapters.map((item) => {
    if (!isRecord(item)) {
      return null;
    }
    const title = cleanText(item.title);
    const chapterSummary = cleanText(item.summary);
    const startTimestampMs = item.startTimestampMs === null
      ? null
      : typeof item.startTimestampMs === 'number' && Number.isInteger(item.startTimestampMs) && item.startTimestampMs >= 0
        ? item.startTimestampMs
        : null;
    return title && chapterSummary ? { title, summary: chapterSummary, startTimestampMs } : null;
  }).filter((item): item is SessionIntelligenceContent['chapters'][number] => Boolean(item)) : null;

  if (summary === null || keyPoints === null || actionItems === null || chapters === null) {
    throw new SessionIntelligenceProviderError(
      'INTELLIGENCE_INVALID_RESPONSE',
      'The intelligence provider returned an incomplete structured response.',
    );
  }

  return { summary, keyPoints, actionItems, chapters };
}

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as Record<string, unknown>;
  if (typeof candidate.status === 'number') {
    return candidate.status;
  }
  const response = candidate.response;
  return isRecord(response) && typeof response.status === 'number' ? response.status : null;
}

function providerCode(error: unknown): string | number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' || typeof code === 'number' ? code : null;
}

export function createGeminiSessionIntelligenceProvider(ai: GoogleGenAI): SessionIntelligenceProvider {
  return {
    async generate(input) {
      let interaction: { output_text?: string };
      try {
        interaction = await ai.interactions.create({
          model: SESSION_INTELLIGENCE_MODEL,
          input: buildSessionIntelligenceInstruction(input.preferredTranscript, input.languageContext),
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: SESSION_INTELLIGENCE_SCHEMA,
          },
        });
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[Recall] intelligence provider request failed', {
            model: SESSION_INTELLIGENCE_MODEL,
            status: providerStatus(error),
            code: providerCode(error),
          });
        }
        throw new SessionIntelligenceProviderError(
          'INTELLIGENCE_PROVIDER_FAILED',
          'The intelligence provider could not generate session notes.',
        );
      }

      try {
        return parseSessionIntelligenceContent(interaction.output_text || '');
      } catch (error) {
        if (error instanceof SessionIntelligenceProviderError) {
          throw error;
        }
        throw new SessionIntelligenceProviderError(
          'INTELLIGENCE_INVALID_RESPONSE',
          'The intelligence provider returned unreadable output.',
        );
      }
    },
  };
}

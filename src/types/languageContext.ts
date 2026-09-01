export interface TranscriptLanguageContext {
  likelyLanguages?: string[];
  localeHints?: string[];
  preserveCodeSwitching?: boolean;
}

export const DEFAULT_TRANSCRIPT_LANGUAGE_CONTEXT: Required<TranscriptLanguageContext> = {
  likelyLanguages: [],
  localeHints: [],
  preserveCodeSwitching: true,
};

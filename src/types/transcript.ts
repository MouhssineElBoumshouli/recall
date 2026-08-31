export type TranscriptKind = 'interim' | 'final';

export interface TranscriptSegment {
  id: string;
  text: string;
  relativeTimestampMs: number;
  finalized: true;
  sessionGeneration: number;
  connectionId: string;
}

export interface InterimTranscript {
  text: string;
  relativeTimestampMs: number;
  finalized: false;
  sessionGeneration: number;
  connectionId: string;
}

export interface TranscriptSnapshot {
  finalizedSegments: TranscriptSegment[];
  interim: InterimTranscript | null;
}

export interface TranscriptInput {
  kind: TranscriptKind;
  text: string;
  relativeTimestampMs: number;
  sessionGeneration: number;
  connectionId: string;
  sourceId?: string;
}

import type {
  InterimTranscript,
  TranscriptInput,
  TranscriptSegment,
  TranscriptSnapshot,
} from '@/types/transcript';

const DUPLICATE_WINDOW_MS = 2_000;

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export class TranscriptAccumulator {
  private readonly segments: TranscriptSegment[] = [];

  private interim: InterimTranscript | null = null;

  private nextId = 1;

  private readonly seenFinals = new Map<string, number>();

  public setInterim(input: TranscriptInput): TranscriptSnapshot {
    const text = normalizeText(input.text);

    this.interim = text
      ? {
          text,
          relativeTimestampMs: input.relativeTimestampMs,
          finalized: false,
          sessionGeneration: input.sessionGeneration,
          connectionId: input.connectionId,
        }
      : null;

    return this.snapshot();
  }

  public appendFinal(input: TranscriptInput): TranscriptSegment | null {
    const text = normalizeText(input.text);
    if (!text) {
      return null;
    }

    this.pruneSeenFinals(input.relativeTimestampMs);

    const normalizedSourceId = input.sourceId?.trim();
    const dedupeKey = normalizedSourceId
      ? `source:${normalizedSourceId}`
      : `text:${text.toLocaleLowerCase()}`;
    const previousTimestamp = this.seenFinals.get(dedupeKey);

    if (
      previousTimestamp !== undefined &&
      (normalizedSourceId || Math.abs(input.relativeTimestampMs - previousTimestamp) <= DUPLICATE_WINDOW_MS)
    ) {
      this.interim = null;
      return null;
    }

    this.seenFinals.set(dedupeKey, input.relativeTimestampMs);
    const segment: TranscriptSegment = {
      id: normalizedSourceId || `segment-${this.nextId++}`,
      text,
      relativeTimestampMs: input.relativeTimestampMs,
      finalized: true,
      sessionGeneration: input.sessionGeneration,
      connectionId: input.connectionId,
    };

    this.segments.push(segment);
    this.interim = null;
    return segment;
  }

  public clearInterim(): TranscriptSnapshot {
    this.interim = null;
    return this.snapshot();
  }

  public reset(): void {
    this.segments.length = 0;
    this.interim = null;
    this.nextId = 1;
    this.seenFinals.clear();
  }

  public snapshot(): TranscriptSnapshot {
    return {
      finalizedSegments: [...this.segments],
      interim: this.interim,
    };
  }

  private pruneSeenFinals(currentTimestampMs: number): void {
    for (const [key, timestampMs] of this.seenFinals) {
      if (!key.startsWith('source:') && currentTimestampMs - timestampMs > DUPLICATE_WINDOW_MS) {
        this.seenFinals.delete(key);
      }
    }
  }
}

export function joinFinalTranscript(segments: TranscriptSegment[]): string {
  return segments.map((segment) => segment.text).join('\n\n');
}

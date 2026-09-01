export type RefinementStatus = 'idle' | 'refining' | 'succeeded' | 'failed';

export interface TranscriptRefinementState {
  status: RefinementStatus;
  text: string | null;
  model: string | null;
  error: string | null;
  attempts: number;
  completedAt: string | null;
}

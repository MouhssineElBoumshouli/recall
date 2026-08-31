import type { AudioRecording } from '@siteed/audio-studio';

import type { Bookmark } from './bookmark';
import type { TranscriptSegment } from './transcript';

export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'stopped';

export interface RecordingDebugInfo {
  connectionState: string;
  sessionGeneration: number;
  rotationCount: number;
  reconnectAttempts: number;
  bufferedAudioChunks: number;
  droppedAudioChunks: number;
  lastError: string | null;
}

export interface StoppedRecording {
  recording: AudioRecording | null;
  durationMs: number;
  finalizedSegments: TranscriptSegment[];
  bookmarks: Bookmark[];
  debug: RecordingDebugInfo;
}

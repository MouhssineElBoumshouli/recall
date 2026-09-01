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
  socketOpened: boolean;
  setupComplete: boolean;
  audioChunksSent: number;
  serverMessagesReceived: number;
  interimTranscriptEvents: number;
  finalTranscriptEvents: number;
  turnCompleteReceived: boolean;
  audioStreamEndSent: boolean;
  tokenFetched: boolean;
  setupMessageSent: boolean;
  setupTimedOut: boolean;
  socketErrorCount: number;
  lastServerMessageDataType: string | null;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
  lastError: string | null;
}

export interface StoppedRecording {
  recording: AudioRecording | null;
  durationMs: number;
  finalizedSegments: TranscriptSegment[];
  bookmarks: Bookmark[];
  debug: RecordingDebugInfo;
}

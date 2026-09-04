import { Directory, File, Paths } from 'expo-file-system';

const sessionsDirectoryName = 'sessions';
const audioFileName = 'audio.wav';

function normalizeFileUri(uri: string): string {
  if (uri.startsWith('file:///')) {
    return uri;
  }
  return uri.startsWith('file:/') ? uri.replace('file:/', 'file:///') : uri;
}

function sessionDirectory(sessionId: string): Directory {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error('Invalid local session identifier.');
  }
  return new Directory(Paths.document, sessionsDirectoryName, sessionId);
}

export interface DurableAudio {
  uri: string;
  size: number;
}

export async function persistRecordingAudio(sourceUri: string | null, sessionId: string): Promise<DurableAudio> {
  if (!sourceUri) {
    throw new Error('The native recorder did not return an audio file.');
  }

  const source = new File(normalizeFileUri(sourceUri));
  if (!source.exists || source.size <= 0) {
    throw new Error('The finalized recording file is missing or empty.');
  }

  const destinationDirectory = sessionDirectory(sessionId);
  destinationDirectory.create({ intermediates: true, idempotent: true });
  const destination = new File(destinationDirectory, audioFileName);

  try {
    await source.copy(destination);
    if (!destination.exists || destination.size <= 0) {
      throw new Error('The durable recording copy is missing or empty.');
    }
    if (source.uri !== destination.uri) {
      try {
        source.delete();
      } catch {
        // The durable copy is authoritative; an undeleted source is harmless.
      }
    }
    return { uri: destination.uri, size: destination.size };
  } catch (error) {
    if (destination.exists) {
      try {
        destination.delete();
      } catch {
        // Preserve the original failure; cleanup is best effort.
      }
    }
    throw error;
  }
}

export function isAudioFileAvailable(audioUri: string): boolean {
  try {
    const file = new File(normalizeFileUri(audioUri));
    return file.exists && file.size > 0;
  } catch {
    return false;
  }
}

export function deleteSessionAudio(sessionId: string): void {
  const directory = sessionDirectory(sessionId);
  if (directory.exists) {
    directory.delete();
  }
}

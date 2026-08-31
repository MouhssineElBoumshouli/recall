export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'rotating'
  | 'reconnecting'
  | 'unavailable'
  | 'stopping';

export type ConnectionEvent =
  | { type: 'start' }
  | { type: 'connected' }
  | { type: 'rotationRequested' }
  | { type: 'connectionLost' }
  | { type: 'retry' }
  | { type: 'failed' }
  | { type: 'stop' }
  | { type: 'stopped' };

export function transitionConnectionState(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  switch (event.type) {
    case 'start':
      return state === 'idle' ? 'connecting' : state;
    case 'connected':
      return state === 'stopping' ? state : 'connected';
    case 'rotationRequested':
      return state === 'connected' ? 'rotating' : state;
    case 'connectionLost':
      return state === 'stopping' || state === 'idle' ? state : 'reconnecting';
    case 'retry':
      return state === 'unavailable' || state === 'reconnecting' ? 'reconnecting' : state;
    case 'failed':
      return state === 'stopping' || state === 'idle' ? state : 'unavailable';
    case 'stop':
      return state === 'idle' ? state : 'stopping';
    case 'stopped':
      return 'idle';
  }
}

import { describe, expect, it } from 'vitest';

import { transitionConnectionState } from '@/services/connectionState';

describe('connection state transitions', () => {
  it('models connect, loss, retry, and recovery', () => {
    let state = transitionConnectionState('idle', { type: 'start' });
    expect(state).toBe('connecting');
    state = transitionConnectionState(state, { type: 'connected' });
    expect(state).toBe('connected');
    state = transitionConnectionState(state, { type: 'connectionLost' });
    expect(state).toBe('reconnecting');
    state = transitionConnectionState(state, { type: 'retry' });
    expect(state).toBe('reconnecting');
    state = transitionConnectionState(state, { type: 'connected' });
    expect(state).toBe('connected');
  });

  it('does not allow a late connected event to escape stopping state', () => {
    const stopping = transitionConnectionState('connected', { type: 'stop' });
    expect(stopping).toBe('stopping');
    expect(transitionConnectionState(stopping, { type: 'connected' })).toBe('stopping');
    expect(transitionConnectionState(stopping, { type: 'stopped' })).toBe('idle');
  });
});

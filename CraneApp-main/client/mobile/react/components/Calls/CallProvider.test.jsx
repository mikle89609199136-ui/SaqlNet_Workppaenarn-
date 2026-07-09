import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallProvider, useCall } from './CallProvider.jsx';
import { eventBus } from '../../../core/EventBus.js';
import * as useRealtimeSocketModule from '../../hooks/useRealtimeSocket.js';

// Mock the realtime socket hook
const mockSocket = {
  isConnected: true,
  send: vi.fn(),
};

vi.mock('../../hooks/useRealtimeSocket.js', () => ({
  useRealtimeSocket: () => ({ socket: mockSocket }),
}));

vi.mock('../../../application/services/serviceContainer.js', () => ({
  services: {
    callService: {
      createRoom: vi.fn().mockResolvedValue({ id: 'room-123' }),
    },
    chatService: {
      getMembers: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock child component to test context
function TestChild() {
  const { incomingCall, acceptCall, activeCall, initiateCall } = useCall();
  
  return (
    <div>
      {incomingCall && <button onClick={acceptCall}>Accept Call from {incomingCall.fromName}</button>}
      {activeCall && <div data-testid="active-call">Active Call in Room {activeCall.roomId}</div>}
      <button onClick={() => initiateCall('chat123', 'p2p', 'Alice', 'video')}>Start Call</button>
    </div>
  );
}

describe('CallProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (eventBus.events instanceof Map) {
      eventBus.events.clear();
    }
  });

  it('should handle incoming call events from eventBus', () => {
    render(
      <CallProvider>
        <TestChild />
      </CallProvider>
    );
    
    // Simulate incoming call
    act(() => {
      eventBus.emit('call_incoming', { roomId: 'room-123', from: 'user-2', fromName: 'Bob', kind: 'audio' });
    });
    
    expect(screen.getByText('Accept Call from Bob')).toBeInTheDocument();
  });

  it('should accept incoming call and send response', () => {
    render(
      <CallProvider>
        <TestChild />
      </CallProvider>
    );
    
    act(() => {
      eventBus.emit('call_incoming', { roomId: 'room-123', from: 'user-2', fromName: 'Bob', kind: 'audio' });
    });
    
    act(() => {
      screen.getByText('Accept Call from Bob').click();
    });
    
    expect(mockSocket.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'call_invite_response',
      accepted: true,
      roomId: 'room-123'
    }));
    
    expect(screen.getByTestId('active-call')).toBeInTheDocument();
  });
  
  it('should initiate a call and send invite payloads', async () => {
    // Setup local storage for user
    localStorage.setItem('craneapp_user_data', JSON.stringify({ id: 'user-1', firstName: 'Alice' }));
    
    render(
      <CallProvider>
        <TestChild />
      </CallProvider>
    );
    
    await act(async () => {
      screen.getByText('Start Call').click();
    });
    
    // Check if socket sent invite
    expect(mockSocket.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'call_invite',
      to: 'chat123', // Since it's p2p, to is chat123
      roomId: 'room-123'
    }));
    
    expect(screen.getByTestId('active-call')).toBeInTheDocument();
  });
});

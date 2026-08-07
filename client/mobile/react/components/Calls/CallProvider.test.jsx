import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallProvider } from './CallProvider.jsx';
import { useCall } from '../../hooks/useCall.js';
import { eventBus } from '../../core/EventBus.js';

// Mock the realtime socket hook
const mockSocket = {
  isConnected: true,
  send: vi.fn(),
};

vi.mock('../../hooks/useRealtimeSocket.js', () => ({
  useRealtimeSocket: () => ({ socket: mockSocket, eventBus }),
}));

vi.mock('../../services/serviceContainer.js', () => ({
  default: {
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
      <button onClick={() => initiateCall('chat123', 'private', 'Alice', 'video', 'user-2')}>Start Call</button>
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
      to: 'user-2',
      roomId: 'room-123'
    }));
    
    expect(screen.getByTestId('active-call')).toBeInTheDocument();
  });

  it('should reject incoming calls while already in a call', async () => {
    localStorage.setItem('craneapp_user_data', JSON.stringify({ id: 'user-1', firstName: 'Alice' }));

    render(
      <CallProvider>
        <TestChild />
      </CallProvider>
    );

    await act(async () => {
      screen.getByText('Start Call').click();
    });

    act(() => {
      eventBus.emit('call_incoming', { roomId: 'room-456', from: 'user-3', fromName: 'Bob', kind: 'audio' });
    });

    expect(mockSocket.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'call_invite_response',
      to: 'user-3',
      roomId: 'room-456',
      accepted: false,
      reason: 'busy',
    }));
  });

  it('should close the active call when the invite is rejected', async () => {
    localStorage.setItem('craneapp_user_data', JSON.stringify({ id: 'user-1', firstName: 'Alice' }));

    render(
      <CallProvider>
        <TestChild />
      </CallProvider>
    );

    await act(async () => {
      screen.getByText('Start Call').click();
    });
    expect(screen.getByTestId('active-call')).toBeInTheDocument();

    act(() => {
      eventBus.emit('call_invite_response', { roomId: 'room-123', from: 'user-2', accepted: false, reason: 'busy' });
    });

    expect(screen.queryByTestId('active-call')).not.toBeInTheDocument();
  });
});

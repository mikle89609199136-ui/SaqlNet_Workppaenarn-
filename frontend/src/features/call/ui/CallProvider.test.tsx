import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallProvider } from './CallProvider';
import { useCallStore } from '../model/callStore';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { eventBus } from '@/shared/lib/event-bus';
import type { WebSocketClient } from '@/services/WebSocketClient';

const mockSend = vi.fn();
const mockSocket = {
  isConnected: true,
  send: mockSend,
} as unknown as WebSocketClient;

import * as sharedApi from '@/shared/api';

vi.mock('@/services/ringtone', () => ({
  startRingtone: vi.fn(),
  stopRingtone: vi.fn(),
}));

vi.mock('@/services/ringtone', () => ({
  startRingtone: vi.fn(),
  stopRingtone: vi.fn(),
}));

describe('CallProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(sharedApi, 'useRealtimeSocket').mockReturnValue({
      socket: mockSocket,
      eventBus,
    });
    useCallStore.setState({
      fsm: {
        state: 'idle',
        roomId: null,
        chatId: null,
        peerId: null,
        peerName: null,
        peerAvatar: null,
        callKind: 'audio',
        roomType: 'p2p',
        title: null,
        endReason: null,
        callStartedAt: null,
      },
      socket: mockSocket,
      incomingCall: null,
      activeCall: null,
      callFrameRef: null,
      isMinimized: false,
    });
  });

  it('игнорирует call_peer_left из чужой комнаты', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
        roomId: 'current-room',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_peer_left',
      roomId: 'alien-room',
      peer: { userId: 'stranger' },
    });

    expect(useCallStore.getState().fsm.state).toBe('active');
  });

  it('завершает звонок при call_peer_left из текущей комнаты', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
        roomId: 'current-room',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_peer_left',
      roomId: 'current-room',
      peer: { userId: 'partner' },
    });

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('peer_ended');
  });

  it('переводит принявшего звонок (callee) в active при получении call_joined с участниками', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'connecting',
        roomId: 'room-1',
        peerId: 'caller-1',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_joined',
      roomId: 'room-1',
      peers: [{ userId: 'caller-1' }],
      self: { userId: 'callee-1' },
    });

    expect(useCallStore.getState().fsm.state).toBe('active');
    expect(useCallStore.getState().fsm.callStartedAt).toBeGreaterThan(0);
  });

  it('игнорирует call_peer_joined из чужой комнаты', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'connecting',
        roomId: 'my-room',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_peer_joined',
      roomId: 'alien-room',
      peer: { userId: 'someone' },
    });

    expect(useCallStore.getState().fsm.state).toBe('connecting');
  });

  it('переводит в active при call_peer_joined текущей комнаты', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'connecting',
        roomId: 'my-room',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_peer_joined',
      roomId: 'my-room',
      peer: { userId: 'my-peer' },
    });

    expect(useCallStore.getState().fsm.state).toBe('active');
  });

  it('обрабатывает завершение звонка из iframe (crane_call_ended)', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
        roomId: 'room-test',
      },
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'crane_call_ended' },
      })
    );

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('completed');
  });

  it('обрабатывает сворачивание звонка из iframe (crane_call_minimize)', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    expect(useCallStore.getState().isMinimized).toBe(false);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'crane_call_minimize' },
      })
    );

    expect(useCallStore.getState().isMinimized).toBe(true);
  });
});

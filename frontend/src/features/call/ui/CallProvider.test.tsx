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

  it('завершает звонок с peer_ended при call_peer_left с reason: left для active', () => {
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
      reason: 'left',
    });

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('peer_ended');
  });

  it('завершает звонок с peer_ended при call_peer_left с reason: left для reconnecting', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'reconnecting',
        roomId: 'current-room',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_peer_left',
      roomId: 'current-room',
      peer: { userId: 'partner' },
      reason: 'left',
    });

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('peer_ended');
  });

  it('переводит звонок в reconnecting при call_peer_left с reason: disconnected для active', () => {
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
      reason: 'disconnected',
    });

    expect(useCallStore.getState().fsm.state).toBe('reconnecting');
  });

  it('переводит звонок в reconnecting при call_peer_left для connecting', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'connecting',
        roomId: 'current-room',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_peer_left',
      roomId: 'current-room',
      peer: { userId: 'partner' },
      reason: 'disconnected',
    });

    expect(useCallStore.getState().fsm.state).toBe('reconnecting');
  });

  it('завершает звонок при call_peer_left, если состояние не active/connecting/reconnecting', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'incoming',
        roomId: 'current-room',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_peer_left',
      roomId: 'current-room',
      peer: { userId: 'partner' },
      reason: 'disconnected',
    });

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('peer_ended');
  });

  it('не завершает звонок при call_peer_left с reason: disconnected, если уже идет reconnecting', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'reconnecting',
        roomId: 'current-room',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_peer_left',
      roomId: 'current-room',
      peer: { userId: 'partner' },
      reason: 'disconnected',
    });

    expect(useCallStore.getState().fsm.state).toBe('reconnecting');
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

  it('сообщения окон (старый call.html) звонок не завершают и не сворачивают (#776)', () => {
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

    for (const type of ['crane_call_ended', 'crane_call_minimize']) {
      window.dispatchEvent(new MessageEvent('message', { data: { type } }));
    }

    expect(useCallStore.getState().fsm.state).toBe('active');
    expect(useCallStore.getState().isMinimized).toBe(false);
  });

  it('обрабатывает события BroadcastChannel через CallProvider', async () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'incoming',
        roomId: 'tab-room-1',
        peerId: 'peer-tab',
      },
      incomingCall: {
        roomId: 'tab-room-1',
        from: 'peer-tab',
        kind: 'audio',
      },
    });

    const otherTabChannel = new BroadcastChannel('craneapp_calls');
    otherTabChannel.postMessage({ type: 'CALL_DISMISSED', roomId: 'tab-room-1' });

    await vi.waitFor(() => {
      expect(useCallStore.getState().fsm.state).toBe('idle');
      expect(useCallStore.getState().incomingCall).toBeNull();
    });

    otherTabChannel.close();
  });

  it('при событии socket:connected вызывает rejoinActiveCall', () => {
    const rejoinSpy = vi.spyOn(useCallStore.getState(), 'rejoinActiveCall');

    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    eventBus.emit('socket:connected', undefined);

    expect(rejoinSpy).toHaveBeenCalled();
  });

  it('при событии call_error для текущей комнаты завершает звонок с network_error', () => {
    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
        roomId: 'room-err-1',
      },
    });

    fakeSocket.emitFlat({
      type: 'call_error',
      roomId: 'room-err-1',
      message: 'Room expired',
    });

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('network_error');
  });

  it('при монтировании вызывает restoreActiveSession', () => {
    const restoreSpy = vi.spyOn(useCallStore.getState(), 'restoreActiveSession');

    render(
      <CallProvider>
        <div>child</div>
      </CallProvider>
    );

    expect(restoreSpy).toHaveBeenCalledTimes(1);
  });
});

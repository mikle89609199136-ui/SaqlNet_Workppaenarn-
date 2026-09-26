import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore } from './callStore';
import { services } from '@/services/serviceContainer';
import { startRingtone, stopRingtone } from '@/services/ringtone';
import { useProfileStore } from '@/entities/user';
import type { WebSocketClient } from '@/services/WebSocketClient';

vi.mock('@/services/ringtone', () => ({
  startRingtone: vi.fn(),
  stopRingtone: vi.fn(),
}));

describe('useCallStore', () => {
  const mockSend = vi.fn();
  const mockSocket = {
    isConnected: true,
    send: mockSend,
  } as unknown as WebSocketClient;

  beforeEach(() => {
    vi.clearAllMocks();
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
      incomingCall: null,
      activeCall: null,
      isMinimized: false,
      socket: mockSocket,
      callFrameRef: null,
      callTimeoutTimer: null,
    });

    useProfileStore.setState({
      user: {
        id: 'self-1',
        firstName: 'Иван',
        lastName: 'Иванов',
        username: 'ivan',
        email: 'ivan@example.com',
        avatarUrl: 'https://example.com/avatar.png',
        createdAt: '2026-01-01T00:00:00Z',
      },
    });
  });

  it('обрабатывает входящий вызов в состоянии idle и запускает рингтон', () => {
    useCallStore.getState().handleIncoming({
      roomId: 'room-1',
      from: 'caller-1',
      fromName: 'Анна',
      kind: 'video',
    });

    const state = useCallStore.getState();
    expect(state.fsm.state).toBe('incoming');
    expect(state.incomingCall).not.toBeNull();
    expect(state.incomingCall?.roomId).toBe('room-1');
    expect(state.incomingCall?.from).toBe('caller-1');
    expect(startRingtone).toHaveBeenCalledTimes(1);
  });

  it('автоматически отклоняет входящий вызов как busy, если уже идет звонок', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
        roomId: 'existing-room',
      },
      activeCall: {
        roomId: 'existing-room',
        type: 'p2p',
        kind: 'audio',
      },
    });

    useCallStore.getState().handleIncoming({
      roomId: 'new-room',
      from: 'second-caller',
      kind: 'audio',
    });

    expect(mockSend).toHaveBeenCalledWith({
      type: 'call_invite_response',
      to: 'second-caller',
      roomId: 'new-room',
      accepted: false,
      reason: 'busy',
    });
    expect(useCallStore.getState().fsm.roomId).toBe('existing-room');
  });

  it('принимает входящий звонок и отправляет accept (call_join делегирован iframe)', () => {
    useCallStore.getState().handleIncoming({
      roomId: 'room-1',
      from: 'caller-1',
      kind: 'video',
    });

    useCallStore.getState().acceptCall();

    expect(stopRingtone).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: 'call_invite_response',
      to: 'caller-1',
      roomId: 'room-1',
      accepted: true,
    });
    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call_join',
      })
    );
    expect(useCallStore.getState().fsm.state).toBe('connecting');
  });

  it('отклоняет входящий вызов и останавливает рингтон', () => {
    useCallStore.getState().handleIncoming({
      roomId: 'room-1',
      from: 'caller-1',
      kind: 'video',
    });

    useCallStore.getState().rejectCall();

    expect(stopRingtone).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: 'call_invite_response',
      to: 'caller-1',
      roomId: 'room-1',
      accepted: false,
      reason: 'declined',
    });
    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('declined');
  });

  it('инициирует исходящий звонок через createRoom и отправляет invite', async () => {
    vi.spyOn(services.callService, 'createRoom').mockResolvedValueOnce({
      success: true,
      room: {
        id: 'created-room-1',
        type: 'p2p',
        callKind: 'audio',
        chatId: 'chat-42',
        title: 'Тест',
        hostId: 'self-1',
      },
      iceServers: [],
      maxParticipants: 2,
    });

    await useCallStore.getState().initiateCall('chat-42', 'p2p', 'Тест', 'audio', 'peer-bob');

    expect(services.callService.createRoom).toHaveBeenCalledWith({
      chatId: 'chat-42',
      type: 'p2p',
      title: 'Тест',
      callKind: 'audio',
    });

    expect(mockSend).toHaveBeenCalledWith({
      type: 'call_invite',
      callType: 'p2p',
      to: 'peer-bob',
      roomId: 'created-room-1',
      kind: 'audio',
      fromName: 'Иван Иванов',
      fromAvatar: 'https://example.com/avatar.png',
      title: 'Тест',
    });

    const state = useCallStore.getState();
    expect(state.fsm.state).toBe('outgoing');
    expect(state.fsm.roomId).toBe('created-room-1');
    expect(state.activeCall?.roomId).toBe('created-room-1');
  });

  it('завершает звонок по endCall и отправляет leave', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
        roomId: 'room-1',
      },
      activeCall: {
        roomId: 'room-1',
        type: 'p2p',
        kind: 'audio',
      },
    });

    useCallStore.getState().endCall('completed');

    expect(mockSend).toHaveBeenCalledWith({
      type: 'call_leave',
      roomId: 'room-1',
    });
    expect(useCallStore.getState().fsm.state).toBe('ended');
  });

  it('повторный call_incoming по той же комнате не отправляет busy и не сбрасывает вызов', () => {
    useCallStore.getState().handleIncoming({
      roomId: 'room-1',
      from: 'caller-1',
      kind: 'video',
    });

    expect(useCallStore.getState().fsm.state).toBe('incoming');
    mockSend.mockClear();

    // Приходит дубликат того же incoming события
    useCallStore.getState().handleIncoming({
      roomId: 'room-1',
      from: 'caller-1',
      kind: 'video',
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(useCallStore.getState().fsm.state).toBe('incoming');
  });

  it('входящий звонок во время исходящего отвечает busy и сохраняет исходящий вызов', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'outgoing',
        roomId: 'my-outgoing-room',
        peerId: 'alice',
      },
      activeCall: {
        roomId: 'my-outgoing-room',
        type: 'p2p',
        kind: 'audio',
      },
    });

    useCallStore.getState().handleIncoming({
      roomId: 'other-room',
      from: 'bob',
      kind: 'audio',
    });

    expect(mockSend).toHaveBeenCalledWith({
      type: 'call_invite_response',
      to: 'bob',
      roomId: 'other-room',
      accepted: false,
      reason: 'busy',
    });
    expect(useCallStore.getState().fsm.roomId).toBe('my-outgoing-room');
    expect(useCallStore.getState().fsm.state).toBe('outgoing');
  });

  it('call_cancelled во время connecting завершает звонок с peer_ended', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'connecting',
        roomId: 'room-1',
        peerId: 'caller-1',
      },
      activeCall: {
        roomId: 'room-1',
        type: 'p2p',
        kind: 'video',
      },
    });

    useCallStore.getState().handleCancelled({
      type: 'call_cancelled',
      roomId: 'room-1',
    });

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('peer_ended');
  });

  it('таймаут 60 секунд при отсутствии ответа завершает исходящий звонок с no_answer', async () => {
    vi.useFakeTimers();

    vi.spyOn(services.callService, 'createRoom').mockResolvedValueOnce({
      success: true,
      room: {
        id: 'room-timeout',
        type: 'p2p',
        callKind: 'audio',
        chatId: 'chat-1',
        title: 'Тест',
        hostId: 'self-1',
      },
      iceServers: [],
      maxParticipants: 2,
    });

    await useCallStore.getState().initiateCall('chat-1', 'p2p', 'Тест', 'audio', 'peer-1');
    expect(useCallStore.getState().fsm.state).toBe('outgoing');

    vi.advanceTimersByTime(60_000);

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('no_answer');

    vi.useRealTimers();
  });

  it('корректно форматирует имя пользователя без фамилии (без undefined)', async () => {
    useProfileStore.setState({
      user: {
        id: 'self-2',
        firstName: 'Иван',
        lastName: undefined,
        username: 'ivan_unique',
        email: 'ivan@example.com',
        avatarUrl: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    });

    vi.spyOn(services.callService, 'createRoom').mockResolvedValueOnce({
      success: true,
      room: {
        id: 'room-name-test',
        type: 'p2p',
        callKind: 'audio',
        chatId: 'chat-1',
        title: 'Тест',
        hostId: 'self-2',
      },
      iceServers: [],
      maxParticipants: 2,
    });

    await useCallStore.getState().initiateCall('chat-1', 'p2p', 'Тест', 'audio', 'peer-2');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call_invite',
        fromName: 'Иван',
      })
    );
  });

  it('отложенный сброс предыдущего звонка не сбрасывает начавшийся новый звонок', () => {
    vi.useFakeTimers();

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
        roomId: 'old-room',
      },
    });

    // Завершаем старый звонок
    useCallStore.getState().endCall('completed');
    expect(useCallStore.getState().fsm.state).toBe('ended');

    // Через 200 мс (до истечения 800 мс таймаута) приходит новый входящий вызов
    vi.advanceTimersByTime(200);
    useCallStore.getState().handleIncoming({
      roomId: 'new-room',
      from: 'new-caller',
      kind: 'audio',
    });
    expect(useCallStore.getState().fsm.state).toBe('incoming');
    expect(useCallStore.getState().fsm.roomId).toBe('new-room');

    // Проходит остаток времени отложенного сброса старого звонка
    vi.advanceTimersByTime(1000);

    // Новый звонок НЕ должен быть сброшен в idle!
    expect(useCallStore.getState().fsm.state).toBe('incoming');
    expect(useCallStore.getState().fsm.roomId).toBe('new-room');

    vi.useRealTimers();
  });

  it('handleInviteResponse с accepted: false переводит звонок в ended с причиной', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'outgoing',
        roomId: 'room-invite',
        peerId: 'peer-invite',
      },
    });

    useCallStore.getState().handleInviteResponse({
      type: 'call_invite_response',
      roomId: 'room-invite',
      accepted: false,
      reason: 'busy',
    });

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('busy');
  });
});

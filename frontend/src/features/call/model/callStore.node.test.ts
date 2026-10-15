import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_TIMEOUT_MS, useCallStore, _resetCancelledRoomsForTest } from './callStore';
import { services } from '@/services/serviceContainer';
import { startRingtone, stopRingtone } from './callRingtone';
import { useProfileStore, blockedUsersQuery, userKeys } from '@/entities/user';
import { chatKeys } from '@/entities/chat';
import { queryClient } from '@/shared/api';
import type { WebSocketClient } from '@/services/WebSocketClient';

vi.mock('./callRingtone', () => ({
  startRingtone: vi.fn(),
  stopRingtone: vi.fn(),
  isRingtoneActive: vi.fn(),
}));

describe('useCallStore', () => {
  const mockSend = vi.fn();
  const mockSocket = {
    isConnected: true,
    send: mockSend,
  } as unknown as WebSocketClient;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCancelledRoomsForTest();
    services.userService.listBlocked = vi.fn().mockResolvedValue([]);
    queryClient.setQueryData(blockedUsersQuery().queryKey, []);

    vi.spyOn(services.callService, 'getRoom').mockImplementation(async (roomId) => ({
      success: true,
      room: {
        id: roomId,
        type: 'p2p',
        callKind: 'audio',
        // Общая комната на всех звонящих: чат не задан — личный чат ищется по звонящему.
        chatId: '',
        title: '',
        hostId: 'caller-1',
        participants: [
          { userId: 'caller-1' },
          { userId: 'caller-2' },
          { userId: 'second-caller' },
          { userId: 'caller-a' },
          { userId: 'allowed-user' },
          { userId: 'blocked-user-1' },
          { userId: 'blocked-user-2' },
          { userId: 'bob' },
          { userId: 'new-caller' },
          { userId: 'caller-mute' },
          { userId: 'blocked-user' },
          { userId: 'server-blocked' },
          { userId: 'caller-fresh' },
        ],
      },
      iceServers: [],
      maxParticipants: 2,
    }));

    queryClient.setQueryData(chatKeys.list(), [
      { id: 'chat-caller-1', type: 'private', peerId: 'caller-1', title: 'Анна' },
      { id: 'chat-caller-2', type: 'private', peerId: 'caller-2', title: 'Борис' },
      { id: 'chat-second', type: 'private', peerId: 'second-caller', title: 'Второй' },
      { id: 'chat-caller-a', type: 'private', peerId: 'caller-a', title: 'Алексей' },
      { id: 'chat-allowed', type: 'private', peerId: 'allowed-user', title: 'Разрешённый' },
      {
        id: 'chat-blocked-1',
        type: 'private',
        peerId: 'blocked-user-1',
        title: 'Заблокированный 1',
      },
      {
        id: 'chat-blocked-2',
        type: 'private',
        peerId: 'blocked-user-2',
        title: 'Заблокированный 2',
      },
      { id: 'chat-bob', type: 'private', peerId: 'bob', title: 'Боб' },
      { id: 'chat-new-caller', type: 'private', peerId: 'new-caller', title: 'Новый' },
      { id: 'chat-caller-mute', type: 'private', peerId: 'caller-mute', title: 'Без звука' },
      {
        id: 'chat-blocked-user',
        type: 'private',
        peerId: 'blocked-user',
        title: 'Заблокированный',
      },
      { id: 'chat-server-blocked', type: 'private', peerId: 'server-blocked', title: 'Спаммер' },
      { id: 'chat-caller-fresh', type: 'private', peerId: 'caller-fresh', title: 'Свежий' },
    ]);

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
        outgoingPhase: null,
      },
      incomingCall: null,
      outgoingCall: null,
      activeCall: null,
      isMinimized: false,
      socket: mockSocket,
      callTimeoutTimer: null,
      reconnectTimeoutTimer: null,
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
      settings: {
        sounds: true,
      } as any,
    });
  });

  it('обрабатывает входящий вызов в состоянии idle и запускает рингтон', async () => {
    await useCallStore.getState().handleIncoming({
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

  it('принимает входящий звонок и отправляет accept и call_join', async () => {
    await useCallStore.getState().handleIncoming({
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
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call_join',
        roomId: 'room-1',
      })
    );
    expect(useCallStore.getState().fsm.state).toBe('connecting');
  });

  it('отклоняет входящий вызов и останавливает рингтон', async () => {
    await useCallStore.getState().handleIncoming({
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

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call_join',
        roomId: 'created-room-1',
      })
    );

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

  it('повторный call_incoming по той же комнате не отправляет busy и не сбрасывает вызов', async () => {
    await useCallStore.getState().handleIncoming({
      roomId: 'room-1',
      from: 'caller-1',
      kind: 'video',
    });

    expect(useCallStore.getState().fsm.state).toBe('incoming');
    mockSend.mockClear();

    // Приходит дубликат того же incoming события
    await useCallStore.getState().handleIncoming({
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

  it('отложенный сброс предыдущего звонка не сбрасывает начавшийся новый звонок', async () => {
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
    await useCallStore.getState().handleIncoming({
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
      from: 'peer-invite',
      accepted: false,
      reason: 'busy',
    });

    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('busy');
  });

  it('запускает рингтон, если выключены только звуки сообщений sounds: false (#1002)', async () => {
    useProfileStore.setState({
      settings: {
        sounds: false,
      } as any,
    });

    await useCallStore.getState().handleIncoming({
      roomId: 'room-mute',
      from: 'caller-mute',
      kind: 'audio',
    });

    expect(useCallStore.getState().fsm.state).toBe('incoming');
    expect(startRingtone).toHaveBeenCalledTimes(1);
  });

  it('не запускает рингтон, если callSounds: false в настройках (#1002)', async () => {
    useProfileStore.setState({
      settings: {
        sounds: true,
        callSounds: false,
      } as any,
    });

    await useCallStore.getState().handleIncoming({
      roomId: 'room-mute-2',
      from: 'caller-mute',
      kind: 'audio',
    });

    expect(useCallStore.getState().fsm.state).toBe('incoming');
    expect(startRingtone).not.toHaveBeenCalled();
  });

  it('тихо игнорирует входящий вызов от пользователя из чёрного списка', async () => {
    queryClient.setQueryData(blockedUsersQuery().queryKey, [
      { id: 'blocked-user', username: 'badguy' } as any,
    ]);

    await useCallStore.getState().handleIncoming({
      roomId: 'room-blocked',
      from: 'blocked-user',
      kind: 'audio',
    });

    // Карточка не создаётся, рингтон не звенит, FSM остаётся в idle
    expect(useCallStore.getState().fsm.state).toBe('idle');
    expect(useCallStore.getState().incomingCall).toBeNull();
    expect(startRingtone).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('загружает список заблокированных с сервера, если кеш пуст, и отсекает заблокированного', async () => {
    queryClient.clear();
    queryClient.setQueryData(chatKeys.list(), [
      { id: 'chat-server-blocked', type: 'private', peerId: 'server-blocked', title: 'Спаммер' },
    ]);
    vi.spyOn(services.callService, 'getRoom').mockResolvedValueOnce({
      success: true,
      room: {
        id: 'room-uncached',
        type: 'p2p',
        callKind: 'audio',
        chatId: 'chat-server-blocked',
        title: '',
        hostId: 'server-blocked',
        participants: [{ userId: 'server-blocked' }],
      },
      iceServers: [],
      maxParticipants: 2,
    });
    services.userService.listBlocked = vi
      .fn()
      .mockResolvedValue([{ id: 'server-blocked', username: 'spammer' }]);

    await useCallStore.getState().handleIncoming({
      roomId: 'room-uncached',
      from: 'server-blocked',
      kind: 'audio',
    });

    expect(services.userService.listBlocked).toHaveBeenCalledTimes(1);
    expect(useCallStore.getState().fsm.state).toBe('idle');
    expect(startRingtone).not.toHaveBeenCalled();
  });

  it('отмена исходящего вызова через cancelCall отправляет leave и сбрасывает FSM', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'outgoing',
        roomId: 'outgoing-room-1',
        peerId: 'peer-alice',
        outgoingPhase: 'ringing',
      },
      outgoingCall: {
        roomId: 'outgoing-room-1',
        peerId: 'peer-alice',
        kind: 'audio',
        phase: 'ringing',
      },
    });

    useCallStore.getState().cancelCall();

    expect(mockSend).toHaveBeenCalledWith({
      type: 'call_leave',
      roomId: 'outgoing-room-1',
    });
    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('cancelled');
    expect(useCallStore.getState().fsm.outgoingPhase).toBe('cancelled');
  });

  it('handleBroadcastEvent сбрасывает входящий звонок при ответе в другой вкладке', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'incoming',
        roomId: 'multi-tab-room',
        peerId: 'caller-1',
      },
      incomingCall: {
        roomId: 'multi-tab-room',
        from: 'caller-1',
        kind: 'audio',
      },
    });

    useCallStore.getState().handleBroadcastEvent({
      type: 'CALL_DISMISSED',
      roomId: 'multi-tab-room',
    });

    expect(stopRingtone).toHaveBeenCalledTimes(1);
    expect(useCallStore.getState().fsm.state).toBe('idle');
    expect(useCallStore.getState().incomingCall).toBeNull();
  });

  it('handleInviteResponse с reason busy переводит outgoingPhase в busy', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'outgoing',
        roomId: 'busy-room',
        peerId: 'peer-busy',
        outgoingPhase: 'ringing',
      },
    });

    useCallStore.getState().handleInviteResponse({
      type: 'call_invite_response',
      roomId: 'busy-room',
      from: 'peer-busy',
      accepted: false,
      reason: 'busy',
    });

    expect(useCallStore.getState().fsm.outgoingPhase).toBe('busy');
    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('busy');
  });

  it('handleInviteResponse с reason declined переводит outgoingPhase в declined', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'outgoing',
        roomId: 'declined-room',
        peerId: 'peer-declined',
        outgoingPhase: 'ringing',
      },
    });

    useCallStore.getState().handleInviteResponse({
      type: 'call_invite_response',
      roomId: 'declined-room',
      from: 'peer-declined',
      accepted: false,
      reason: 'declined',
    });

    expect(useCallStore.getState().fsm.outgoingPhase).toBe('declined');
    expect(useCallStore.getState().fsm.state).toBe('ended');
    expect(useCallStore.getState().fsm.endReason).toBe('declined');
  });

  it('outgoingCall остаётся доступным в состоянии ended до RESET_TO_IDLE для отображения статуса', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'outgoing',
        roomId: 'room-status',
        peerId: 'peer-status',
        peerName: 'Сергей',
        outgoingPhase: 'ringing',
      },
    });

    // Респондент занят
    useCallStore.getState().handleInviteResponse({
      type: 'call_invite_response',
      roomId: 'room-status',
      from: 'peer-status',
      accepted: false,
      reason: 'busy',
    });

    const state = useCallStore.getState();
    expect(state.fsm.state).toBe('ended');
    expect(state.fsm.outgoingPhase).toBe('busy');
    // Селектор outgoingCall не должен быть null, чтобы оверлей показал "Занят"
    expect(state.outgoingCall).not.toBeNull();
    expect(state.outgoingCall?.phase).toBe('busy');
    expect(state.outgoingCall?.peerName).toBe('Сергей');
  });

  it('быстрый перенабор: устаревший createRoom не перезаписывает новый звонок и отправляет leave', async () => {
    let resolveFirstRoom!: (val: any) => void;
    const firstRoomPromise = new Promise((resolve) => {
      resolveFirstRoom = resolve;
    });

    let resolveSecondRoom!: (val: any) => void;
    const secondRoomPromise = new Promise((resolve) => {
      resolveSecondRoom = resolve;
    });

    vi.spyOn(services.callService, 'createRoom')
      .mockImplementationOnce(() => firstRoomPromise as any)
      .mockImplementationOnce(() => secondRoomPromise as any);

    // 1. Начинаем первый вызов
    const p1 = useCallStore
      .getState()
      .initiateCall('chat-1', 'p2p', 'Первый', 'audio', 'peer-1', null, 'Алиса');

    expect(useCallStore.getState().fsm.state).toBe('outgoing');
    expect(useCallStore.getState().fsm.phase ?? useCallStore.getState().fsm.outgoingPhase).toBe(
      'calling'
    );

    // 2. Пользователь отменяет и сразу начинает второй звонок
    useCallStore.getState().cancelCall();

    const p2 = useCallStore
      .getState()
      .initiateCall('chat-2', 'p2p', 'Второй', 'audio', 'peer-2', null, 'Боб');

    mockSend.mockClear();

    // 3. Первый createRoom с опозданием завершается
    resolveFirstRoom({
      success: true,
      room: { id: 'room-stale', type: 'p2p', callKind: 'audio', chatId: 'chat-1' },
    });
    await p1;

    // Первый (устаревший) звонок должен отправить leave для созданной устаревшей комнаты
    expect(mockSend).toHaveBeenCalledWith({
      type: 'call_leave',
      roomId: 'room-stale',
    });
    // И НЕ должен отправлять invite для peer-1
    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call_invite',
        to: 'peer-1',
      })
    );

    // Состояние второго звонка не должно пострадать
    expect(useCallStore.getState().fsm.state).toBe('outgoing');
    expect(useCallStore.getState().fsm.peerId).toBe('peer-2');

    // 4. Второй createRoom завершается успешно
    resolveSecondRoom({
      success: true,
      room: { id: 'room-active-2', type: 'p2p', callKind: 'audio', chatId: 'chat-2' },
    });
    await p2;

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call_invite',
        to: 'peer-2',
        roomId: 'room-active-2',
      })
    );
    expect(useCallStore.getState().fsm.roomId).toBe('room-active-2');
    expect(useCallStore.getState().fsm.outgoingPhase).toBe('ringing');
  });

  it('отправляет busy, если во время асинхронной проверки чёрного списка начался другой звонок', async () => {
    let resolveBlockedQuery!: (val: any) => void;
    queryClient.clear();
    queryClient.setQueryData(chatKeys.list(), [
      { id: 'chat-caller-a', type: 'private', peerId: 'caller-a', title: 'Алексей' },
    ]);
    vi.spyOn(services.callService, 'getRoom').mockResolvedValueOnce({
      success: true,
      room: {
        id: 'room-race',
        type: 'p2p',
        callKind: 'audio',
        chatId: 'chat-caller-a',
        title: '',
        hostId: 'caller-a',
        participants: [{ userId: 'caller-a' }],
      },
      iceServers: [],
      maxParticipants: 2,
    });
    services.userService.listBlocked = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBlockedQuery = resolve;
        })
    );

    // Приходит входящий вызов от caller-a, начинается асинхронный ensureQueryData
    const incomingPromise = useCallStore.getState().handleIncoming({
      roomId: 'room-race',
      from: 'caller-a',
      kind: 'audio',
    });

    // Даём микротаскам дойти до проверки чёрного списка
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // Пока проверка идёт, пользователь сам начинает исходящий звонок
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'outgoing',
        roomId: 'my-outgoing',
      },
    });
    mockSend.mockClear();

    // Проверка чёрного списка завершается (пользователь не заблокирован)
    resolveBlockedQuery([]);
    await incomingPromise;

    // Поскольку состояние уже outgoing, входящий вызов должен получить busy ответ
    expect(mockSend).toHaveBeenCalledWith({
      type: 'call_invite_response',
      to: 'caller-a',
      roomId: 'room-race',
      accepted: false,
      reason: 'busy',
    });
    // Исходящий звонок не сбит
    expect(useCallStore.getState().fsm.state).toBe('outgoing');
    expect(useCallStore.getState().fsm.roomId).toBe('my-outgoing');
  });

  it('отложенный RESET_TO_IDLE от отменённого исходящего не сбрасывает новый звонок', async () => {
    vi.useFakeTimers();

    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'outgoing',
        roomId: 'room-cancelled',
      },
      currentAttemptId: 5,
    });

    // Отменяем исходящий звонок (ставится таймаут 400мс на RESET_TO_IDLE)
    useCallStore.getState().cancelCall();
    expect(useCallStore.getState().fsm.state).toBe('ended');

    // Через 100мс начинается новый входящий звонок
    vi.advanceTimersByTime(100);
    await useCallStore.getState().handleIncoming({
      roomId: 'incoming-fresh',
      from: 'caller-fresh',
      kind: 'audio',
    });
    expect(useCallStore.getState().fsm.state).toBe('incoming');
    expect(useCallStore.getState().fsm.roomId).toBe('incoming-fresh');

    // Проходит 500мс (таймаут отмены первого вызова срабатывает)
    vi.advanceTimersByTime(500);

    // Свежий входящий звонок не сброшен!
    expect(useCallStore.getState().fsm.state).toBe('incoming');
    expect(useCallStore.getState().fsm.roomId).toBe('incoming-fresh');

    vi.useRealTimers();
  });

  it('селектор outgoingCall равен null после завершения принятого звонка', () => {
    useCallStore.getState().dispatch({
      type: 'START_OUTGOING',
      payload: {
        roomId: 'room-accepted-test',
        chatId: 'chat-1',
        peerId: 'peer-1',
        kind: 'audio',
      },
    });

    expect(useCallStore.getState().outgoingCall).not.toBeNull();

    // Собеседник принял вызов
    useCallStore.getState().handleInviteResponse({
      roomId: 'room-accepted-test',
      from: 'peer-1',
      accepted: true,
    });

    expect(useCallStore.getState().fsm.state).toBe('connecting');
    expect(useCallStore.getState().fsm.outgoingPhase).toBeNull();
    expect(useCallStore.getState().outgoingCall).toBeNull();

    // Звонок завершается
    useCallStore.getState().endCall();

    expect(useCallStore.getState().fsm.state).toBe('ended');
    // Карточка исходящего звонка не должна всплывать повторно!
    expect(useCallStore.getState().outgoingCall).toBeNull();
  });

  it('initiateCall при ошибке сети выставляет фазу failed и завершает звонок с network_error', async () => {
    vi.spyOn(services.callService, 'createRoom').mockRejectedValueOnce(new Error('Network error'));

    await useCallStore
      .getState()
      .initiateCall('chat-1', 'p2p', 'Тест', 'audio', 'peer-1', null, 'Алиса');

    const state = useCallStore.getState();
    expect(state.fsm.state).toBe('ended');
    expect(state.fsm.endReason).toBe('network_error');
    expect(state.fsm.outgoingPhase).toBe('failed');
    expect(state.outgoingCall?.phase).toBe('failed');
  });

  it('initiateCall переводит вызов в phase: declined при ошибке calls_forbidden (#1043)', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(services.callService, 'createRoom').mockRejectedValueOnce({
        code: 'calls_forbidden',
        status: 403,
      });

      await useCallStore
        .getState()
        .initiateCall('chat-1', 'p2p', 'Тест', 'audio', 'peer-1', null, 'Алиса');

      let state = useCallStore.getState();
      expect(state.fsm.state).toBe('ended');
      expect(state.fsm.endReason).toBe('declined');
      expect(state.fsm.outgoingPhase).toBe('declined');
      expect(state.outgoingCall?.phase).toBe('declined');

      vi.advanceTimersByTime(1500);

      state = useCallStore.getState();
      expect(state.fsm.state).toBe('idle');
      expect(state.outgoingCall).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('initiateCall переводит вызов в phase: declined при ошибке blocked_by_user (#1043)', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(services.callService, 'createRoom').mockRejectedValueOnce({
        code: 'blocked_by_user',
        status: 403,
      });

      await useCallStore
        .getState()
        .initiateCall('chat-1', 'p2p', 'Тест', 'audio', 'peer-1', null, 'Алиса');

      let state = useCallStore.getState();
      expect(state.fsm.state).toBe('ended');
      expect(state.fsm.endReason).toBe('declined');
      expect(state.fsm.outgoingPhase).toBe('declined');
      expect(state.outgoingCall?.phase).toBe('declined');

      vi.advanceTimersByTime(1500);

      state = useCallStore.getState();
      expect(state.fsm.state).toBe('idle');
      expect(state.outgoingCall).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('initiateCall при 403 с code access_denied оставляет сбой failed и network_error (#1043)', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(services.callService, 'createRoom').mockRejectedValueOnce({
        code: 'access_denied',
        status: 403,
      });

      await useCallStore
        .getState()
        .initiateCall('chat-1', 'p2p', 'Тест', 'audio', 'peer-1', null, 'Алиса');

      let state = useCallStore.getState();
      expect(state.fsm.state).toBe('ended');
      expect(state.fsm.endReason).toBe('network_error');
      expect(state.fsm.outgoingPhase).toBe('failed');
      expect(state.outgoingCall?.phase).toBe('failed');

      vi.advanceTimersByTime(1500);

      state = useCallStore.getState();
      expect(state.fsm.state).toBe('idle');
      expect(state.outgoingCall).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('восстановление связи и реконнект (PR 1 / #775)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('при переходе в reconnecting запускает таймер на 25 секунд и завершает звонок по таймауту', () => {
      useCallStore.setState({
        fsm: {
          ...useCallStore.getState().fsm,
          state: 'active',
          roomId: 'active-room',
          peerId: 'peer-1',
        },
      });

      useCallStore.getState().dispatch({ type: 'CONNECTION_LOST' });

      expect(useCallStore.getState().fsm.state).toBe('reconnecting');
      expect(useCallStore.getState().reconnectTimeoutTimer).not.toBeNull();

      // Прошло 24.9 сек — всё ещё reconnecting
      vi.advanceTimersByTime(RECONNECT_TIMEOUT_MS - 100);
      expect(useCallStore.getState().fsm.state).toBe('reconnecting');

      // Прошло 25 сек — автозавершение с network_error
      vi.advanceTimersByTime(100);
      expect(useCallStore.getState().fsm.state).toBe('ended');
      expect(useCallStore.getState().fsm.endReason).toBe('network_error');
    });

    it('при восстановлении связи (CONNECTION_RESTORED) сбрасывает reconnectTimeoutTimer', () => {
      useCallStore.setState({
        fsm: {
          ...useCallStore.getState().fsm,
          state: 'active',
          roomId: 'active-room',
          peerId: 'peer-1',
        },
      });

      useCallStore.getState().dispatch({ type: 'CONNECTION_LOST' });
      expect(useCallStore.getState().fsm.state).toBe('reconnecting');
      expect(useCallStore.getState().reconnectTimeoutTimer).not.toBeNull();

      // Связь восстановилась через 5 секунд
      vi.advanceTimersByTime(5000);
      useCallStore.getState().dispatch({ type: 'CONNECTION_RESTORED' });

      expect(useCallStore.getState().fsm.state).toBe('active');
      expect(useCallStore.getState().reconnectTimeoutTimer).toBeNull();

      // Дальнейшее течение времени не завершает звонок
      vi.advanceTimersByTime(30000);
      expect(useCallStore.getState().fsm.state).toBe('active');
    });

    it('ручной endCall во время reconnecting сбрасывает таймер переподключения', () => {
      useCallStore.setState({
        fsm: {
          ...useCallStore.getState().fsm,
          state: 'active',
          roomId: 'active-room',
          peerId: 'peer-1',
        },
      });

      useCallStore.getState().dispatch({ type: 'CONNECTION_LOST' });
      expect(useCallStore.getState().reconnectTimeoutTimer).not.toBeNull();

      useCallStore.getState().endCall('completed');

      expect(useCallStore.getState().fsm.state).toBe('ended');
      expect(useCallStore.getState().reconnectTimeoutTimer).toBeNull();
    });

    it('rejoinActiveCall отправляет call_join в комнату при активном звонке', () => {
      mockSend.mockClear();
      useCallStore.setState({
        fsm: {
          ...useCallStore.getState().fsm,
          state: 'active',
          roomId: 'active-room',
          peerId: 'peer-1',
          callKind: 'video',
          chatId: 'chat-1',
        },
      });

      useCallStore.getState().rejoinActiveCall();

      expect(mockSend).toHaveBeenCalledWith({
        type: 'call_join',
        roomId: 'active-room',
        displayName: 'Иван Иванов',
        avatarUrl: 'https://example.com/avatar.png',
        callKind: 'video',
        chatId: 'chat-1',
        title: undefined,
      });
    });

    it('rejoinActiveCall ничего не шлет, если звонок в idle', () => {
      mockSend.mockClear();
      useCallStore.setState({
        fsm: {
          ...useCallStore.getState().fsm,
          state: 'idle',
          roomId: null,
        },
      });

      useCallStore.getState().rejoinActiveCall();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('attachSocket с подключенным сокетом вызывает rejoinActiveCall при активном звонке', () => {
      mockSend.mockClear();
      useCallStore.setState({
        socket: null,
        fsm: {
          ...useCallStore.getState().fsm,
          state: 'active',
          roomId: 'room-reconnect',
          peerId: 'peer-1',
        },
      });

      useCallStore.getState().attachSocket(mockSocket);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'call_join',
          roomId: 'room-reconnect',
        })
      );
    });

    describe('персистентность сессии и восстановление после F5', () => {
      const mockStorage = new Map<string, string>();
      const fakeSessionStorage = {
        getItem: vi.fn((k: string) => mockStorage.get(k) ?? null),
        setItem: vi.fn((k: string, v: string) => mockStorage.set(k, String(v))),
        removeItem: vi.fn((k: string) => mockStorage.delete(k)),
        clear: vi.fn(() => mockStorage.clear()),
      };

      beforeEach(() => {
        mockStorage.clear();
        vi.stubGlobal('sessionStorage', fakeSessionStorage);
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it('сохраняет сессию в sessionStorage при переходе звонка в active', () => {
        useCallStore.setState({
          fsm: {
            ...useCallStore.getState().fsm,
            state: 'connecting',
            roomId: 'room-persist-1',
            peerId: 'peer-alice',
            peerName: 'Алиса',
            callKind: 'audio',
            roomType: 'p2p',
            isCaller: true,
          },
        });

        useCallStore.getState().dispatch({ type: 'PEER_JOINED' });

        expect(useCallStore.getState().fsm.state).toBe('active');
        expect(fakeSessionStorage.setItem).toHaveBeenCalledWith(
          'crane_active_call_session',
          expect.stringContaining('room-persist-1')
        );
      });

      it('очищает сессию из sessionStorage при завершении звонка endCall', () => {
        useCallStore.setState({
          fsm: {
            ...useCallStore.getState().fsm,
            state: 'active',
            roomId: 'room-persist-1',
            peerId: 'peer-alice',
          },
        });

        useCallStore.getState().endCall('completed');

        expect(fakeSessionStorage.removeItem).toHaveBeenCalledWith('crane_active_call_session');
      });

      const savedSession = (extra: Record<string, unknown> = {}) =>
        mockStorage.set(
          'crane_active_call_session',
          JSON.stringify({
            roomId: 'saved-room-1',
            peerId: 'saved-peer-1',
            peerName: 'Боб',
            peerAvatar: null,
            callKind: 'video',
            roomType: 'p2p',
            callStartedAt: 1234567,
            isCaller: false,
            chatId: 'saved-chat-1',
            title: null,
            savedAt: Date.now(),
            ...extra,
          })
        );

      afterEach(() => {
        useCallStore.getState().dismissResumableCall();
        vi.useRealTimers();
      });

      it('после перезагрузки в звонок не входит сам — предлагает вернуться, пока собеседник ждёт', () => {
        vi.useFakeTimers();
        savedSession({ leftAt: Date.now() - 5_000 });
        mockSend.mockClear();

        const restored = useCallStore.getState().restoreActiveSession();

        expect(restored).toBe(true);
        const state = useCallStore.getState();
        expect(state.fsm.state).toBe('idle');
        expect(state.activeCall).toBeNull();
        expect(state.resumableCall).toMatchObject({
          roomId: 'saved-room-1',
          peerId: 'saved-peer-1',
          peerName: 'Боб',
          callKind: 'video',
        });
        expect(state.resumableCall?.expiresAt).toBe(Date.now() - 5_000 + RECONNECT_TIMEOUT_MS);
        expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'call_join' }));

        // Собеседник перестал ждать — предложение исчезает, сессия стёрта.
        vi.advanceTimersByTime(RECONNECT_TIMEOUT_MS - 5_000);
        expect(useCallStore.getState().resumableCall).toBeNull();
        expect(mockStorage.has('crane_active_call_session')).toBe(false);
      });

      it('ушли со страницы давно — собеседник уже не ждёт, предлагать нечего', () => {
        savedSession({ leftAt: Date.now() - RECONNECT_TIMEOUT_MS - 1 });

        expect(useCallStore.getState().restoreActiveSession()).toBe(false);
        expect(useCallStore.getState().resumableCall).toBeNull();
        expect(mockStorage.has('crane_active_call_session')).toBe(false);
      });

      it('«Вернуться» — звонок восстанавливается: reconnecting, таймаут 25 с и call_join', () => {
        savedSession();
        useCallStore.getState().restoreActiveSession();
        mockSend.mockClear();

        useCallStore.getState().resumeCall();

        const state = useCallStore.getState();
        expect(state.resumableCall).toBeNull();
        expect(state.fsm.state).toBe('reconnecting');
        expect(state.fsm.roomId).toBe('saved-room-1');
        expect(state.fsm.peerId).toBe('saved-peer-1');
        expect(state.activeCall?.roomId).toBe('saved-room-1');
        expect(state.reconnectTimeoutTimer).not.toBeNull();
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'call_join', roomId: 'saved-room-1' })
        );
      });

      it('«Не возвращаться» — предложение и сессия убраны, в звонок не входит', () => {
        savedSession();
        useCallStore.getState().restoreActiveSession();
        mockSend.mockClear();

        useCallStore.getState().dismissResumableCall();

        expect(useCallStore.getState().resumableCall).toBeNull();
        expect(useCallStore.getState().fsm.state).toBe('idle');
        expect(mockStorage.has('crane_active_call_session')).toBe(false);
        expect(mockSend).not.toHaveBeenCalled();
      });

      it('начался другой звонок — предложение вернуться снимается, а сессию нового его таймер не стирает', () => {
        vi.useFakeTimers();
        savedSession();
        useCallStore.getState().restoreActiveSession();

        useCallStore.getState().dispatch({
          type: 'RECEIVE_INCOMING',
          payload: { roomId: 'new-room', from: 'peer-new', fromName: 'Новый', kind: 'audio' },
        });
        expect(useCallStore.getState().resumableCall).toBeNull();

        savedSession({ roomId: 'new-room' });
        vi.advanceTimersByTime(RECONNECT_TIMEOUT_MS + 1_000);
        expect(mockStorage.has('crane_active_call_session')).toBe(true);
      });

      it('restoreActiveSession возвращает false, если хранилище пусто', () => {
        const restored = useCallStore.getState().restoreActiveSession();
        expect(restored).toBe(false);
        expect(useCallStore.getState().fsm.state).toBe('idle');
      });
    });
  });

  describe('безопасность входящих и исходящих вызовов (#854)', () => {
    it('имя и аватар звонящего берутся из профиля / чата, поддельный fromName из invite игнорируется', async () => {
      queryClient.setQueryData(userKeys.profile('caller-alice'), {
        id: 'caller-alice',
        firstName: 'Алиса',
        lastName: 'Иванова',
        username: 'alice',
        avatarUrl: 'https://example.com/alice.png',
      });
      queryClient.setQueryData(chatKeys.list(), [
        {
          id: 'chat-alice',
          type: 'private',
          peerId: 'caller-alice',
          title: 'Алиса Иванова',
          avatarUrl: 'https://example.com/alice.png',
        },
      ]);
      vi.spyOn(services.callService, 'getRoom').mockResolvedValueOnce({
        success: true,
        room: {
          id: 'room-1',
          type: 'p2p',
          callKind: 'audio',
          chatId: 'chat-alice',
          title: '',
          hostId: 'caller-alice',
          participants: [{ userId: 'caller-alice' }],
        },
        iceServers: [],
        maxParticipants: 2,
      });

      await useCallStore.getState().handleIncoming({
        roomId: 'room-1',
        from: 'caller-alice',
        fromName: 'Взломщик',
        fromAvatar: 'https://example.com/hacker.png',
        title: 'Ограбление',
        kind: 'audio',
      });

      const state = useCallStore.getState();
      expect(state.fsm.state).toBe('incoming');
      expect(state.incomingCall?.fromName).toBe('Алиса Иванова');
      expect(state.incomingCall?.fromAvatar).toBe('https://example.com/alice.png');
      expect(state.incomingCall?.title).toBeUndefined();
    });

    it('ответ call_invite_response от постороннего пользователя игнорируется', () => {
      useCallStore.setState({
        fsm: {
          ...useCallStore.getState().fsm,
          state: 'outgoing',
          roomId: 'room-out',
          peerId: 'peer-alice',
        },
      });

      useCallStore.getState().handleInviteResponse({
        roomId: 'room-out',
        from: 'attacker-mallory',
        accepted: false,
        reason: 'busy',
      });

      expect(useCallStore.getState().fsm.state).toBe('outgoing');
    });

    it('устаревший входящий звонок не показывается, если комната 404', async () => {
      vi.spyOn(services.callService, 'getRoom').mockRejectedValueOnce(new Error('Room not found'));

      await useCallStore.getState().handleIncoming({
        roomId: 'stale-room',
        from: 'caller-alice',
        kind: 'audio',
      });

      expect(useCallStore.getState().fsm.state).toBe('idle');
    });

    it('устаревший входящий звонок не показывается, если звонящий отсутствует в комнате', async () => {
      vi.spyOn(services.callService, 'getRoom').mockResolvedValueOnce({
        success: true,
        room: {
          id: 'room-empty',
          type: 'p2p',
          callKind: 'audio',
          chatId: 'chat-1',
          title: '',
          hostId: 'caller-alice',
          participants: [],
        },
        iceServers: [],
        maxParticipants: 2,
      });

      await useCallStore.getState().handleIncoming({
        roomId: 'room-empty',
        from: 'caller-alice',
        kind: 'audio',
      });

      expect(useCallStore.getState().fsm.state).toBe('idle');
    });

    it('входящий звонок не показывается, если нет личного чата со звонящим', async () => {
      queryClient.setQueryData(chatKeys.list(), []);
      queryClient.setQueryData(chatKeys.archived(), []);
      vi.spyOn(services.callService, 'getRoom').mockResolvedValueOnce({
        success: true,
        room: {
          id: 'room-stranger',
          type: 'p2p',
          callKind: 'audio',
          chatId: 'chat-stranger',
          title: '',
          hostId: 'stranger-1',
          participants: [{ userId: 'stranger-1' }],
        },
        iceServers: [],
        maxParticipants: 2,
      });

      await useCallStore.getState().handleIncoming({
        roomId: 'room-stranger',
        from: 'stranger-1',
        kind: 'audio',
      });

      expect(useCallStore.getState().fsm.state).toBe('idle');
    });

    it('ограничивает историю отмененных комнат (FIFO вытеснение сверх лимита 50)', async () => {
      queryClient.setQueryData(chatKeys.list(), [
        {
          id: 'chat-alice',
          type: 'private',
          peerId: 'caller-alice',
          title: 'Алиса',
          avatarUrl: null,
        },
      ]);
      vi.spyOn(services.callService, 'getRoom').mockResolvedValue({
        success: true,
        room: {
          id: 'room-test',
          type: 'p2p',
          callKind: 'audio',
          chatId: 'chat-alice',
          title: '',
          hostId: 'caller-alice',
          participants: [{ userId: 'caller-alice' }],
        },
        iceServers: [],
        maxParticipants: 2,
      });

      for (let i = 0; i < 60; i++) {
        useCallStore.getState().handleCancelled({
          type: 'call_cancelled',
          roomId: `cancelled-room-${i}`,
        });
      }

      // Room 59 всё ещё в списке отменённых — вызов должен отсекаться
      await useCallStore.getState().handleIncoming({
        roomId: 'cancelled-room-59',
        from: 'caller-alice',
        kind: 'audio',
      });
      expect(useCallStore.getState().fsm.state).toBe('idle');

      // Room 0 была вытеснена из-за лимита 50 — вызов не отсекается по отмене
      await useCallStore.getState().handleIncoming({
        roomId: 'cancelled-room-0',
        from: 'caller-alice',
        kind: 'audio',
      });
      expect(useCallStore.getState().fsm.state).toBe('incoming');
    });

    it('первый звонок новому собеседнику звенит, когда чата нет в закешированном списке, но сервер возвращает его по chatQuery', async () => {
      queryClient.setQueryData(chatKeys.list(), []);
      queryClient.setQueryData(chatKeys.archived(), []);

      vi.spyOn(services.callService, 'getRoom').mockResolvedValueOnce({
        success: true,
        room: {
          id: 'room-new-direct',
          type: 'p2p',
          callKind: 'audio',
          chatId: 'chat-new-direct',
          title: '',
          hostId: 'new-peer-1',
          participants: [{ userId: 'new-peer-1' }],
        },
        iceServers: [],
        maxParticipants: 2,
      });

      vi.spyOn(services.chatService, 'getChat').mockResolvedValueOnce({
        id: 'chat-new-direct',
        type: 'private',
        peerId: 'new-peer-1',
        title: 'Новый контакт',
        avatarUrl: null,
        unreadCount: 0,
      } as IChatDto);

      await useCallStore.getState().handleIncoming({
        roomId: 'room-new-direct',
        from: 'new-peer-1',
        kind: 'audio',
      });

      expect(useCallStore.getState().fsm.state).toBe('incoming');
      expect(useCallStore.getState().fsm.roomId).toBe('room-new-direct');
    });

    it('комната ссылается на другой чат — личный чат со звонящим из списка её не подменяет', async () => {
      queryClient.setQueryData(chatKeys.list(), [
        { id: 'chat-bob', type: 'private', peerId: 'peer-bob', title: 'Боб', avatarUrl: null },
      ]);
      queryClient.setQueryData(chatKeys.archived(), []);

      vi.spyOn(services.callService, 'getRoom').mockResolvedValueOnce({
        success: true,
        room: {
          id: 'room-group-x',
          type: 'group',
          callKind: 'audio',
          chatId: 'chat-group-x',
          title: '',
          hostId: 'peer-bob',
          participants: [{ userId: 'peer-bob' }],
        },
        iceServers: [],
        maxParticipants: 8,
      } as never);
      vi.spyOn(services.chatService, 'getChat').mockResolvedValueOnce({
        id: 'chat-group-x',
        type: 'group',
        title: 'Чужая группа',
        avatarUrl: null,
        unreadCount: 0,
      } as IChatDto);

      await useCallStore
        .getState()
        .handleIncoming({ roomId: 'room-group-x', from: 'peer-bob', kind: 'audio' });

      expect(useCallStore.getState().fsm.state).toBe('idle');
    });

    it('отмена вызова во время запроса профиля отменяет звонок и не переводит в incoming', async () => {
      queryClient.setQueryData(chatKeys.list(), [
        {
          id: 'chat-bob',
          type: 'private',
          peerId: 'peer-bob',
          title: 'Боб',
          avatarUrl: null,
        },
      ]);

      vi.spyOn(services.callService, 'getRoom').mockResolvedValueOnce({
        success: true,
        room: {
          id: 'room-bob',
          type: 'p2p',
          callKind: 'audio',
          chatId: 'chat-bob',
          title: '',
          hostId: 'peer-bob',
          participants: [{ userId: 'peer-bob' }],
        },
        iceServers: [],
        maxParticipants: 2,
      });

      queryClient.setQueryData(blockedUsersQuery().queryKey, []);
      queryClient.removeQueries({ queryKey: userKeys.profile('peer-bob') });

      let getProfileCalled = false;
      let resolveProfilePromise: (value: unknown) => void = () => {};
      const profileDeferred = new Promise((resolve) => {
        resolveProfilePromise = resolve;
      });

      vi.spyOn(services.userService, 'getProfile').mockImplementationOnce(() => {
        getProfileCalled = true;
        return profileDeferred as any;
      });

      const incomingPromise = useCallStore.getState().handleIncoming({
        roomId: 'room-bob',
        from: 'peer-bob',
        kind: 'audio',
      });

      // Ждем, пока вызов реально дойдет до getProfile
      while (!getProfileCalled) {
        await new Promise((r) => setTimeout(r, 0));
      }

      // Во время запроса профиля прилетает отмена
      useCallStore.getState().handleCancelled({
        type: 'call_cancelled',
        roomId: 'room-bob',
      });

      resolveProfilePromise({
        id: 'peer-bob',
        firstName: 'Боб',
        lastName: 'Смит',
        username: 'bob',
      });

      await incomingPromise;

      expect(useCallStore.getState().fsm.state).toBe('idle');
    });

    it('повторный call_incoming для той же комнаты после ожидания не отправляет busy, если первый уже звенит', async () => {
      const mockSend = vi.fn();
      const fakeSocket = {
        isConnected: true,
        send: mockSend,
      } as unknown as WebSocketClient;
      useCallStore.getState().attachSocket(fakeSocket);

      queryClient.setQueryData(chatKeys.list(), [
        {
          id: 'chat-alice',
          type: 'private',
          peerId: 'caller-alice',
          title: 'Алиса',
          avatarUrl: null,
        },
      ]);

      vi.spyOn(services.callService, 'getRoom').mockResolvedValue({
        success: true,
        room: {
          id: 'room-duplicate',
          type: 'p2p',
          callKind: 'audio',
          chatId: 'chat-alice',
          title: '',
          hostId: 'caller-alice',
          participants: [{ userId: 'caller-alice' }],
        },
        iceServers: [],
        maxParticipants: 2,
      });

      // Запускаем два параллельных incoming для одной и той же комнаты
      const firstIncoming = useCallStore.getState().handleIncoming({
        roomId: 'room-duplicate',
        from: 'caller-alice',
        kind: 'audio',
      });
      const secondIncoming = useCallStore.getState().handleIncoming({
        roomId: 'room-duplicate',
        from: 'caller-alice',
        kind: 'audio',
      });

      await Promise.all([firstIncoming, secondIncoming]);

      expect(useCallStore.getState().fsm.state).toBe('incoming');
      // Сокет не должен отправлять busy для той же комнаты
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});

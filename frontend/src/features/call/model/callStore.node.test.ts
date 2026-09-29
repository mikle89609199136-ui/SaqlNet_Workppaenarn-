import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore } from './callStore';
import { services } from '@/services/serviceContainer';
import { startRingtone, stopRingtone } from '@/services/ringtone';
import { useProfileStore, blockedUsersQuery } from '@/entities/user';
import { queryClient } from '@/shared/api';
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
    services.userService.listBlocked = vi.fn().mockResolvedValue([]);
    queryClient.setQueryData(blockedUsersQuery().queryKey, []);

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

  it('не запускает рингтон, если звуки выключены в настройках профиля', async () => {
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

    vi
      .spyOn(services.callService, 'createRoom')
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

  it('отложенный RESET_TO_IDLE от отменённого исходящего не сбрасывает новый звонок', () => {
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
    useCallStore.getState().handleIncoming({
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
    vi.spyOn(services.callService, 'createRoom').mockRejectedValueOnce(
      new Error('Network error')
    );

    await useCallStore
      .getState()
      .initiateCall('chat-1', 'p2p', 'Тест', 'audio', 'peer-1', null, 'Алиса');

    const state = useCallStore.getState();
    expect(state.fsm.state).toBe('ended');
    expect(state.fsm.endReason).toBe('network_error');
    expect(state.fsm.outgoingPhase).toBe('failed');
    expect(state.outgoingCall?.phase).toBe('failed');
  });
});


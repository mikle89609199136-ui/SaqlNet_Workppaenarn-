import { describe, expect, it } from 'vitest';
import { callStateReducer, initialCallContext } from './callStateMachine';

describe('callStateMachine', () => {
  it('начинает с idle состояния', () => {
    expect(initialCallContext.state).toBe('idle');
    expect(initialCallContext.roomId).toBeNull();
    expect(initialCallContext.peerId).toBeNull();
  });

  it('переходит из idle в outgoing', () => {
    const next = callStateReducer(initialCallContext, {
      type: 'START_OUTGOING',
      payload: { roomId: 'r1', chatId: 'c1', peerId: 'u2', kind: 'audio', title: 'Звонок' },
    });
    expect(next.state).toBe('outgoing');
    expect(next.roomId).toBe('r1');
    expect(next.chatId).toBe('c1');
    expect(next.peerId).toBe('u2');
    expect(next.callKind).toBe('audio');
    expect(next.title).toBe('Звонок');
  });

  it('игнорирует START_OUTGOING, если уже идет активный звонок', () => {
    const activeCtx = { ...initialCallContext, state: 'active' as const, roomId: 'r1' };
    const next = callStateReducer(activeCtx, {
      type: 'START_OUTGOING',
      payload: { roomId: 'r2', chatId: 'c2', peerId: 'u3', kind: 'video' },
    });
    expect(next.state).toBe('active');
    expect(next.roomId).toBe('r1');
  });

  it('переходит из outgoing в connecting по PEER_ACCEPTED', () => {
    const outgoingCtx = { ...initialCallContext, state: 'outgoing' as const, roomId: 'r1' };
    const next = callStateReducer(outgoingCtx, { type: 'PEER_ACCEPTED' });
    expect(next.state).toBe('connecting');
  });

  it('игнорирует PEER_ACCEPTED, если состояние не outgoing', () => {
    const idleCtx = { ...initialCallContext, state: 'idle' as const };
    const next = callStateReducer(idleCtx, { type: 'PEER_ACCEPTED' });
    expect(next.state).toBe('idle');
  });

  it('переходит из connecting в active по PEER_JOINED', () => {
    const connectingCtx = { ...initialCallContext, state: 'connecting' as const, roomId: 'r1' };
    const next = callStateReducer(connectingCtx, { type: 'PEER_JOINED' });
    expect(next.state).toBe('active');
    expect(next.callStartedAt).toBeGreaterThan(0);
  });

  it('переходит из idle во входящий вызов incoming', () => {
    const next = callStateReducer(initialCallContext, {
      type: 'RECEIVE_INCOMING',
      payload: { roomId: 'r1', from: 'u1', fromName: 'Alice', kind: 'video' },
    });
    expect(next.state).toBe('incoming');
    expect(next.roomId).toBe('r1');
    expect(next.peerId).toBe('u1');
    expect(next.peerName).toBe('Alice');
    expect(next.callKind).toBe('video');
  });

  it('игнорирует RECEIVE_INCOMING, если уже идет разговор', () => {
    const activeCtx = { ...initialCallContext, state: 'active' as const, roomId: 'r1' };
    const next = callStateReducer(activeCtx, {
      type: 'RECEIVE_INCOMING',
      payload: { roomId: 'r2', from: 'u2', kind: 'audio' },
    });
    expect(next.state).toBe('active');
    expect(next.roomId).toBe('r1');
  });

  it('переходит из incoming в connecting по ACCEPT_INCOMING', () => {
    const incomingCtx = { ...initialCallContext, state: 'incoming' as const, roomId: 'r1' };
    const next = callStateReducer(incomingCtx, { type: 'ACCEPT_INCOMING' });
    expect(next.state).toBe('connecting');
  });

  it('переходит из active в reconnecting при обрыве связи', () => {
    const activeCtx = { ...initialCallContext, state: 'active' as const, roomId: 'r1' };
    const next = callStateReducer(activeCtx, { type: 'CONNECTION_LOST' });
    expect(next.state).toBe('reconnecting');
  });

  it('восстанавливает active из reconnecting при восстановлении связи', () => {
    const reconCtx = { ...initialCallContext, state: 'reconnecting' as const, roomId: 'r1' };
    const next = callStateReducer(reconCtx, { type: 'CONNECTION_RESTORED' });
    expect(next.state).toBe('active');
  });

  it('завершает звонок с сохранением причины endReason', () => {
    const activeCtx = { ...initialCallContext, state: 'active' as const, roomId: 'r1' };
    const next = callStateReducer(activeCtx, { type: 'END_CALL', reason: 'declined' });
    expect(next.state).toBe('ended');
    expect(next.endReason).toBe('declined');
  });

  it('игнорирует END_CALL в состоянии idle', () => {
    const next = callStateReducer(initialCallContext, { type: 'END_CALL', reason: 'completed' });
    expect(next.state).toBe('idle');
    expect(next.endReason).toBeNull();
  });

  it('сбрасывает состояние ended в idle по RESET_TO_IDLE при совпадении roomId', () => {
    const endedCtx = {
      ...initialCallContext,
      state: 'ended' as const,
      roomId: 'room-1',
      endReason: 'completed' as const,
    };
    const next = callStateReducer(endedCtx, { type: 'RESET_TO_IDLE', roomId: 'room-1' });
    expect(next.state).toBe('idle');
    expect(next.roomId).toBeNull();
    expect(next.endReason).toBeNull();
  });

  it('игнорирует RESET_TO_IDLE, если roomId не совпадает (новый звонок начался)', () => {
    const endedCtx = {
      ...initialCallContext,
      state: 'ended' as const,
      roomId: 'room-2',
      endReason: 'completed' as const,
    };
    const next = callStateReducer(endedCtx, { type: 'RESET_TO_IDLE', roomId: 'room-1' });
    expect(next.state).toBe('ended');
    expect(next.roomId).toBe('room-2');
  });

  it('игнорирует RESET_TO_IDLE, если состояние не ended', () => {
    const outgoingCtx = {
      ...initialCallContext,
      state: 'outgoing' as const,
      roomId: 'room-new',
    };
    const next1 = callStateReducer(outgoingCtx, { type: 'RESET_TO_IDLE', roomId: 'room-old' });
    expect(next1.state).toBe('outgoing');
    expect(next1.roomId).toBe('room-new');

    const next2 = callStateReducer(outgoingCtx, { type: 'RESET_TO_IDLE', roomId: 'room-new' });
    expect(next2.state).toBe('outgoing');
    expect(next2.roomId).toBe('room-new');

    const next3 = callStateReducer(outgoingCtx, { type: 'RESET_TO_IDLE' });
    expect(next3.state).toBe('outgoing');

    const incomingCtx = {
      ...initialCallContext,
      state: 'incoming' as const,
      roomId: 'room-incoming',
    };
    const nextIncoming = callStateReducer(incomingCtx, { type: 'RESET_TO_IDLE' });
    expect(nextIncoming.state).toBe('incoming');
    expect(nextIncoming.roomId).toBe('room-incoming');
  });

  it('переводит outgoing напрямую в active по PEER_JOINED', () => {
    const outgoingCtx = { ...initialCallContext, state: 'outgoing' as const, roomId: 'r1' };
    const next = callStateReducer(outgoingCtx, { type: 'PEER_JOINED' });
    expect(next.state).toBe('active');
    expect(next.callStartedAt).toBeGreaterThan(0);
  });
});

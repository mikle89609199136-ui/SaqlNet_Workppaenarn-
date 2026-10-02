import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCallSession,
  loadCallSession,
  saveCallSession,
  MAX_SESSION_AGE_MS,
  type IStoredCallSession,
} from './callSessionStorage';

describe('callSessionStorage', () => {
  const sampleSession: Omit<IStoredCallSession, 'savedAt'> = {
    roomId: 'room-123',
    peerId: 'peer-456',
    peerName: 'Иван',
    peerAvatar: 'https://example.com/avatar.png',
    callKind: 'video',
    roomType: 'p2p',
    callStartedAt: 1700000000000,
    isCaller: true,
    chatId: 'chat-789',
    title: 'Звонок 1:1',
  };

  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('сохраняет сессию и загружает её корректно', () => {
    saveCallSession(sampleSession);

    const loaded = loadCallSession();
    expect(loaded).not.toBeNull();
    expect(loaded?.roomId).toBe('room-123');
    expect(loaded?.peerId).toBe('peer-456');
    expect(loaded?.peerName).toBe('Иван');
    expect(loaded?.callKind).toBe('video');
    expect(loaded?.isCaller).toBe(true);
    expect(loaded?.savedAt).toBeGreaterThan(0);
  });

  it('clearCallSession удаляет запись из sessionStorage', () => {
    saveCallSession(sampleSession);
    expect(loadCallSession()).not.toBeNull();

    clearCallSession();
    expect(loadCallSession()).toBeNull();
  });

  it('loadCallSession возвращает null при повреждённом JSON и очищает storage', () => {
    window.sessionStorage.setItem('crane_active_call_session', '{invalid-json');

    expect(loadCallSession()).toBeNull();
  });

  it('loadCallSession возвращает null при неполных данных и очищает storage', () => {
    window.sessionStorage.setItem(
      'crane_active_call_session',
      JSON.stringify({ roomId: 'only-room' })
    );

    expect(loadCallSession()).toBeNull();
    expect(window.sessionStorage.getItem('crane_active_call_session')).toBeNull();
  });

  it('loadCallSession очищает устаревшую сессию старше MAX_SESSION_AGE_MS', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    saveCallSession(sampleSession);

    // Смещаем время вперёд на 2 часа и 1 секунду
    vi.setSystemTime(now + MAX_SESSION_AGE_MS + 1000);

    expect(loadCallSession()).toBeNull();
    expect(window.sessionStorage.getItem('crane_active_call_session')).toBeNull();
  });
});

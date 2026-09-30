import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config';
import { clearLegacySessionToken, hasStoredSession } from './session';

/* Признак активной cookie-сессии на клиенте — сохранённый профиль (#705). */

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('признак сохранённой сессии', () => {
  it('есть, когда сохранён профиль', () => {
    localStorage.setItem(STORAGE_KEYS.USER, '{"id":"user-1"}');
    expect(hasStoredSession()).toBe(true);
  });

  it('отсутствует без профиля', () => {
    expect(hasStoredSession()).toBe(false);
  });
});

describe('очистка токена старой версии', () => {
  it('удаляет токен, не затрагивая сохранённый профиль', () => {
    localStorage.setItem(STORAGE_KEYS.LEGACY_TOKEN, 'legacy-token');
    localStorage.setItem(STORAGE_KEYS.USER, '{"id":"user-id"}');

    clearLegacySessionToken();

    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_TOKEN)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.USER)).toBe('{"id":"user-id"}');
  });
});

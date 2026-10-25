import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { createApiClient } from './apiFactory';
import { clearLegacySessionToken, hasStoredSession, isSessionAlive } from './session';

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

/* Жива ли сессия на сервере (#1070): `false` — только на 401. */
describe('isSessionAlive', () => {
  const respond = (handler: Parameters<typeof http.get>[1]) =>
    server.use(http.get(api('/users/me'), handler));

  it('401 — сессии нет, и клиент сообщает о выходе', async () => {
    respond(() => HttpResponse.json({ code: 'token_revoked' }, { status: 401 }));
    const onUnauthorized = vi.fn();

    expect(await isSessionAlive(createApiClient({ onUnauthorized }))).toBe(false);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('200 — сессия жива', async () => {
    respond(() => HttpResponse.json({ user: { id: 'user-1' } }));

    expect(await isSessionAlive(createApiClient())).toBe(true);
  });

  it.each([
    ['503', () => HttpResponse.json({}, { status: 503 })],
    ['сеть', () => HttpResponse.error()],
  ])('%s — проверить не удалось, считаем живой', async (_name, handler) => {
    respond(handler);
    const onUnauthorized = vi.fn();

    expect(await isSessionAlive(createApiClient({ onUnauthorized }))).toBe(true);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

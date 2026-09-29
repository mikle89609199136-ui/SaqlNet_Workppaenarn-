import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config';
import { api, API } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { ApiClient } from './ApiClient';
import { exchangeLegacySession, hasStoredSession } from './session';

/* Переход на cookie без повторного входа (#705). */

const client = () => new ApiClient(API);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('обмен токена прежней версии на cookie', () => {
  it('токен уходит один раз в заголовке и стирается; профиль остаётся', async () => {
    localStorage.setItem(STORAGE_KEYS.LEGACY_TOKEN, 'legacy-token');
    localStorage.setItem(STORAGE_KEYS.USER, '{"id":"user-1"}');
    const seen: Array<string | null> = [];
    server.use(
      http.post(api('/auth/session'), ({ request }) => {
        seen.push(request.headers.get('Authorization'));
        return new HttpResponse(null, { status: 204 });
      })
    );

    await exchangeLegacySession(client());
    await exchangeLegacySession(client());

    expect(seen).toEqual(['Bearer legacy-token']);
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_TOKEN)).toBeNull();
    expect(hasStoredSession()).toBe(true);
  });

  it('сервер токен не принял — сессии нет: стирается и профиль', async () => {
    localStorage.setItem(STORAGE_KEYS.LEGACY_TOKEN, 'revoked');
    localStorage.setItem(STORAGE_KEYS.USER, '{"id":"user-1"}');
    server.use(
      http.post(api('/auth/session'), () =>
        HttpResponse.json({ code: 'token_revoked' }, { status: 401 })
      )
    );

    await exchangeLegacySession(client());

    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_TOKEN)).toBeNull();
    expect(hasStoredSession()).toBe(false);
  });

  it('нет сети — токен остаётся до следующего запуска', async () => {
    localStorage.setItem(STORAGE_KEYS.LEGACY_TOKEN, 'legacy-token');
    localStorage.setItem(STORAGE_KEYS.USER, '{"id":"user-1"}');
    server.use(http.post(api('/auth/session'), () => HttpResponse.error()));

    await exchangeLegacySession(client());

    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_TOKEN)).toBe('legacy-token');
    expect(hasStoredSession()).toBe(true);
  });

  it('старого токена нет — ничего не запрашивает', async () => {
    let called = false;
    server.use(
      http.post(api('/auth/session'), () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      })
    );

    await exchangeLegacySession(client());

    expect(called).toBe(false);
  });
});

import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { api, API } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { ApiClient } from './ApiClient';

// Проверка в jsdom, а не в node: истёкшая сессия объявляется событием окна,
// и слушает его AuthGuard. В окружении node объявлять некому.
describe('ApiClient в браузере', () => {
  it('should announce an expired session on 401', async () => {
    const listener = vi.fn();
    window.addEventListener('craneapp:unauthorized', listener);

    server.use(http.get(api('/chats'), () => HttpResponse.json({}, { status: 401 })));

    await new ApiClient(API).get('/chats').catch(() => {});

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('craneapp:unauthorized', listener);
  });

  it('should stay silent on other error codes', async () => {
    const listener = vi.fn();
    window.addEventListener('craneapp:unauthorized', listener);

    server.use(http.get(api('/chats'), () => HttpResponse.json({}, { status: 500 })));

    await new ApiClient(API).get('/chats').catch(() => {});

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('craneapp:unauthorized', listener);
  });
});

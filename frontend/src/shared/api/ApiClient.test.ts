import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { api, API } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { ApiClient } from './ApiClient';
import { createApiClient } from './apiFactory';

describe('ApiClient: обработка 401', () => {
  it('should call onUnauthorized callback on 401 response', async () => {
    const onUnauthorized = vi.fn();

    server.use(
      http.get(api('/chats'), () => HttpResponse.json({ code: 'session_expired' }, { status: 401 }))
    );

    await new ApiClient(API, { onUnauthorized }).get('/chats').catch(() => {});

    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onUnauthorized).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 401,
        code: 'session_expired',
      })
    );
  });

  it('should support updating handler via setOnUnauthorized', async () => {
    const onUnauthorized = vi.fn();

    server.use(
      http.get(api('/chats'), () => HttpResponse.json({ code: 'token_expired' }, { status: 401 }))
    );

    const client = new ApiClient(API);
    client.setOnUnauthorized(onUnauthorized);

    await client.get('/chats').catch(() => {});

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('should stay silent on other error codes', async () => {
    const onUnauthorized = vi.fn();

    server.use(http.get(api('/chats'), () => HttpResponse.json({}, { status: 500 })));

    await new ApiClient(API, { onUnauthorized }).get('/chats').catch(() => {});

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('createApiClient should pass onUnauthorized option to client', async () => {
    const onUnauthorized = vi.fn();

    server.use(
      http.get(api('/chats'), () => HttpResponse.json({ code: 'session_expired' }, { status: 401 }))
    );

    const client = createApiClient({ baseUrl: API, onUnauthorized });
    await client.get('/chats').catch(() => {});

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

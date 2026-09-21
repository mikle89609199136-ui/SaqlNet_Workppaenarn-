import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api, API } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { ApiClient } from './ApiClient';
import type { IApiError } from './ApiClient';

function createClient(token: string | null = null) {
  return new ApiClient(API, { getToken: () => token });
}

describe('ApiClient: сборка адреса', () => {
  it('should append the endpoint to the base url', async () => {
    let received = '';
    server.use(
      http.get(api('/chats/abc'), ({ request }) => {
        received = request.url;
        return HttpResponse.json({ ok: true });
      })
    );

    await createClient().get('/chats/abc');

    expect(received).toBe(`${API}/chats/abc`);
  });

  it('should put query parameters into the url and skip empty ones', async () => {
    let received = '';
    server.use(
      http.get(api('/messages/chat-1'), ({ request }) => {
        received = request.url;
        return HttpResponse.json({ messages: [] });
      })
    );

    await createClient().get('/messages/chat-1', {
      limit: 50,
      offset: 0,
      cursor: null,
      search: undefined,
    });

    const url = new URL(received);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(url.searchParams.has('search')).toBe(false);
  });

  it('should use an absolute endpoint as is', async () => {
    let received = '';
    server.use(
      http.get('https://media.example.com/file.png', ({ request }) => {
        received = request.url;
        return HttpResponse.json({ ok: true });
      })
    );

    await createClient().get('https://media.example.com/file.png');

    expect(received).toBe('https://media.example.com/file.png');
  });
});

describe('ApiClient: заголовки', () => {
  it('should send the bearer token when it is available', async () => {
    let authorization: string | null = null;
    server.use(
      http.get(api('/users/me'), ({ request }) => {
        authorization = request.headers.get('Authorization');
        return HttpResponse.json({ id: 'user-1' });
      })
    );

    await createClient('session-token-abc').get('/users/me');

    expect(authorization).toBe('Bearer session-token-abc');
  });

  it('should omit authorization without a token', async () => {
    let authorization: string | null = 'не тронуто';
    server.use(
      http.get(api('/users/me'), ({ request }) => {
        authorization = request.headers.get('Authorization');
        return HttpResponse.json({ id: 'user-1' });
      })
    );

    await createClient(null).get('/users/me');

    expect(authorization).toBeNull();
  });

  it('should drop content-type when there is no body', async () => {
    let contentType: string | null = null;
    server.use(
      http.delete(api('/messages/m-1'), ({ request }) => {
        contentType = request.headers.get('Content-Type');
        return HttpResponse.json({ success: true });
      })
    );

    await createClient().delete('/messages/m-1');

    expect(contentType).toBeNull();
  });
});

describe('ApiClient: разбор ответа', () => {
  it('should return parsed json with status and headers', async () => {
    server.use(
      http.get(api('/chats'), () =>
        HttpResponse.json({ chats: [{ id: 'chat-1' }] }, { status: 200 })
      )
    );

    const response = await createClient().get<{ chats: { id: string }[] }>('/chats');

    expect(response.data.chats).toHaveLength(1);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('should return plain text when the response is not json', async () => {
    server.use(http.get(api('/chats'), () => HttpResponse.text('просто текст')));

    const response = await createClient().get<string>('/chats');

    expect(response.data).toBe('просто текст');
  });
});

describe('ApiClient: ошибки', () => {
  it('should prefer the error field of the payload as a message', async () => {
    server.use(
      http.get(api('/chats'), () =>
        HttpResponse.json({ error: 'чат недоступен', message: 'запасное' }, { status: 400 })
      )
    );

    const failure = await createClient()
      .get('/chats')
      .catch((error: IApiError) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as IApiError).message).toBe('чат недоступен');
    expect((failure as IApiError).status).toBe(400);
    expect((failure as IApiError).data).toEqual({ error: 'чат недоступен', message: 'запасное' });
  });

  it('should fall back to the message field', async () => {
    server.use(
      http.get(api('/chats'), () => HttpResponse.json({ message: 'нет прав' }, { status: 403 }))
    );

    const failure = await createClient()
      .get('/chats')
      .catch((error: IApiError) => error);

    expect((failure as IApiError).message).toBe('нет прав');
  });

  it('should report 401 without depending on the browser event target', async () => {
    // Вне браузера объявить об истёкшей сессии некому: globalThis в Node
    // не EventTarget. Запрос обязан завершиться ошибкой, а не упасть на
    // попытке отправить событие. Само событие проверяется в ApiClient.test.ts.
    server.use(http.get(api('/chats'), () => HttpResponse.json({}, { status: 401 })));

    const failure = await createClient()
      .get('/chats')
      .catch((error: IApiError) => error);

    expect((failure as IApiError).status).toBe(401);
  });
});

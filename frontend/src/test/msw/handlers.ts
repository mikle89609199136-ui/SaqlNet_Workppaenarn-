import { http, HttpResponse } from 'msw';

// Базовый адрес задаётся в vitest.config.js через VITE_API_BASE_URL,
// чтобы обработчики не зависели от того, где выполняется тест.
export const API = import.meta.env?.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v2';

export const api = (path: string) => `${API}${path}`;

/**
 * Обработчики по умолчанию: пустой, но валидный сервер. Тест, которому нужны
 * данные, добавляет свои через server.use — перекрывая эти.
 *
 * Незакрытый маршрут намеренно не отвечает пустотой: server настроен на
 * onUnhandledRequest: 'error', поэтому забытый запрос виден сразу.
 */
export const defaultHandlers = [
  http.get(api('/users/me'), () =>
    HttpResponse.json({ id: 'user-1', username: 'tester', firstName: 'Тестовый' })
  ),

  http.get(api('/users/:userId/profile'), ({ params }) =>
    HttpResponse.json({
      user: {
        id: params.userId,
        username: 'tester',
        firstName: 'Тестовый',
        lastName: '',
        avatarUrl: '',
        bio: '',
        isOnline: false,
      },
    })
  ),

  // Настройки и приватность сервер отдаёт одним ответом. Пустые объекты, а
  // не выдуманные значения: раздел обязан работать на том, чего сервер не
  // прислал, и тест, которому нужны конкретные настройки, задаёт их сам.
  http.get(api('/users/settings'), () => HttpResponse.json({ settings: {}, privacy: {} })),

  http.put(api('/users/settings'), async ({ request }) =>
    HttpResponse.json({ settings: await request.json() })
  ),

  http.put(api('/users/privacy'), async ({ request }) =>
    HttpResponse.json({ privacy: await request.json() })
  ),

  http.get(api('/chats'), () => HttpResponse.json({ chats: [] })),

  http.get(api('/chats/:chatId'), ({ params }) =>
    HttpResponse.json({
      chat: {
        id: params.chatId,
        type: 'private',
        title: 'Тестовый чат',
        peerPublicKey: null,
      },
    })
  ),

  http.get(api('/chats/:chatId/pins'), () => HttpResponse.json({ pins: [] })),

  http.get(api('/messages/:chatId'), () => HttpResponse.json({ messages: [] })),

  http.post(api('/messages/read'), () => HttpResponse.json({ success: true })),

  http.post(api('/auth/public-key'), () => HttpResponse.json({ success: true })),

  // Ключи шифрования: по умолчанию сервер пуст, как у нового аккаунта.
  http.post(api('/encryption/keys'), () => HttpResponse.json({ ok: true })),

  http.get(api('/encryption/keys/:userId'), () =>
    HttpResponse.json({ code: 'key_not_found' }, { status: 404 })
  ),

  http.get(api('/encryption/chat-keys/:chatId'), () => HttpResponse.json({ keys: [] })),

  http.post(api('/encryption/chat-keys/:chatId'), () => HttpResponse.json({ ok: true })),

  http.post(api('/encryption/rotate-key/:chatId'), () => HttpResponse.json({ ok: true })),

  http.get(api('/encryption/my-key/:chatId'), () =>
    HttpResponse.json({ code: 'key_not_found' }, { status: 404 })
  ),

  http.get(api('/chats/:chatId/members'), () => HttpResponse.json({ members: [] })),
];

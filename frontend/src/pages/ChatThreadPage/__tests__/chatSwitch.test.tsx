import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { createTestQueryClient, renderChatThread } from '@/test/harness/renderChatThread';

/**
 * Пользователь уходит из чата раньше, чем сервер отвечает на запрос истории.
 * Запоздавший ответ относится к покинутому чату и в открытую ленту попасть
 * не должен.
 *
 * Раньше попадал: сравнение шло с идентификатором из рефа экземпляра, а при
 * переходе экземпляр перемонтировался, и проверка пропускала чужой ответ
 * в общий стор (#258).
 */
describe('смена чата на лету', () => {
  it('should keep the late history of the left chat out of the open one', async () => {
    const firstChat = makeChat({ title: 'Первый чат' });
    const lateHistory = [
      makeMessage({ chatId: firstChat.id, content: 'запоздавшая история первого чата' }),
    ];

    const secondChat = makeChat({ title: 'Второй чат' });
    const secondMessages = [
      makeMessage({ chatId: secondChat.id, content: 'сообщение второго чата' }),
    ];

    // Тест должен точно знать момент, когда сервер отдал ответ: иначе
    // проверка запоздавших данных превращается в ожидание наугад.
    let releaseResponse: () => void = () => {};
    const responseSent = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    server.use(
      http.get(api(`/chats/${firstChat.id}`), () => HttpResponse.json({ chat: firstChat })),
      http.get(api(`/chats/${secondChat.id}`), () => HttpResponse.json({ chat: secondChat })),
      http.get(api(`/chats/${firstChat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.get(api(`/chats/${secondChat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.get(api(`/messages/${firstChat.id}`), async () => {
        await delay(120);
        releaseResponse();
        return HttpResponse.json({ messages: lateHistory });
      }),
      http.post(api('/messages/read'), () => HttpResponse.json({ success: true }))
    );

    // Клиент запросов общий на оба рендера: в приложении он один на вкладку,
    // и разделение по чатам должен обеспечивать проверяемый код, а не тест.
    const queryClient = createTestQueryClient();

    // История первого чата не засеивается: она должна прийти запросом,
    // который не успеет завершиться до ухода.
    const firstRender = renderChatThread({ chat: firstChat, queryClient });
    await screen.findByText('Первый чат');

    firstRender.unmount();
    renderChatThread({ chat: secondChat, messages: secondMessages, queryClient });

    expect(await screen.findByText('Второй чат')).toBeInTheDocument();
    expect(screen.getByText('сообщение второго чата')).toBeInTheDocument();

    await responseSent;

    // Ответ по первому чату лёг в кеш своего ключа и в открытую ленту
    // не попал: перепутать их теперь физически нечем.
    await waitFor(() =>
      expect(screen.queryByText('запоздавшая история первого чата')).not.toBeInTheDocument()
    );
    expect(screen.getByText('Второй чат')).toBeInTheDocument();
  });
});

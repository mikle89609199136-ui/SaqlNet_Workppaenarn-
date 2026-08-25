import { delay, http, HttpResponse } from 'msw';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderChatThread } from '@/test/harness/renderChatThread';

/**
 * Пользователь уходит из чата раньше, чем сервер отвечает на запрос его
 * истории. Ожидалось бы, что запоздавший ответ не попадёт в открытый
 * следующим чат; тест фиксирует фактическое поведение — попадает.
 */
describe('смена чата на лету', () => {
  it('should show the late history of the first chat in the already open second chat', async () => {
    const firstChat = makeChat({ title: 'Первый чат' });
    const firstMessages = [
      makeMessage({ chatId: firstChat.id, content: 'сообщение первого чата' }),
    ];
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
      http.get(api(`/messages/${firstChat.id}`), async () => {
        await delay(120);
        releaseResponse();
        return HttpResponse.json({ messages: lateHistory });
      }),
      http.get(api(`/messages/${secondChat.id}`), () => HttpResponse.json({ messages: [] }))
    );

    const firstRender = renderChatThread({ chat: firstChat, messages: firstMessages });

    const thread = (await screen.findByText('сообщение первого чата')).closest('section')!;

    // Догрузка истории висит на прокрутке ленты вверх, а jsdom не считает
    // размеры: без подменённых высот обработчик решает, что прокручивать нечего,
    // и запроса за историей не будет вовсе.
    Object.defineProperty(thread, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(thread, 'clientHeight', { value: 300, configurable: true });
    thread.scrollTop = 0;
    fireEvent.scroll(thread);

    // Уход из чата, пока запрос ещё в полёте. Харнесс умеет открыть другой чат
    // только новым рендером — так выглядит возврат к списку и переход в
    // соседний чат; экземпляр страницы при этом создаётся заново.
    firstRender.unmount();
    renderChatThread({ chat: secondChat, messages: secondMessages });

    expect(await screen.findByText('Второй чат')).toBeInTheDocument();
    expect(screen.getByText('сообщение второго чата')).toBeInTheDocument();

    await responseSent;

    // ФАКТИЧЕСКОЕ ПОВЕДЕНИЕ: история первого чата дописывается в ленту уже
    // открытого второго чата. Ожидалось бы queryByText(...) === null: ответ
    // относится к чату, из которого пользователь ушёл.
    expect(await screen.findByText('запоздавшая история первого чата')).toBeInTheDocument();

    // Заголовок при этом остаётся вторым чатом — перепутана именно лента.
    expect(screen.getByText('Второй чат')).toBeInTheDocument();
    // Собственные сообщения первого чата не протекают: их вытеснила загрузка
    // второго. Протекает только то, что пришло с опозданием.
    expect(screen.queryByText('сообщение первого чата')).not.toBeInTheDocument();
  });
});

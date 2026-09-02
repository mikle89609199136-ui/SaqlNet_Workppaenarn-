import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeChatScenario, makeMessage } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

/** Размер страницы истории: столько сообщений приходит за один запрос. */
const PAGE_SIZE = 50;

interface IHistoryRequest {
  offset: string | null;
  limit: string | null;
}

describe('подгрузка истории чата', () => {
  it('should request the next page with offset=50 when the thread is scrolled to the top', async () => {
    const { chat, messages } = makeChatScenario({ messages: PAGE_SIZE });

    // Сообщения предыдущей страницы: их метки времени раньше самого раннего
    // из уже показанных, иначе «старое» было бы старым только по названию.
    const firstShownAt = new Date(messages[0].createdAt).getTime();
    const olderMessages = Array.from({ length: 5 }, (_, index) =>
      makeMessage({
        chatId: chat.id,
        content: `старое ${index + 1}`,
        createdAt: new Date(firstShownAt - (5 - index) * 60_000),
      })
    );

    const historyRequests: IHistoryRequest[] = [];

    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.get(api(`/messages/${chat.id}`), ({ request }) => {
        const params = new URL(request.url).searchParams;
        historyRequests.push({ offset: params.get('offset'), limit: params.get('limit') });

        return HttpResponse.json({
          messages: params.get('offset') === String(PAGE_SIZE) ? olderMessages : [],
        });
      })
    );

    const { container } = renderChatThread({ chat, messages });

    expect(await screen.findByText(`сообщение ${PAGE_SIZE}`)).toBeInTheDocument();

    // Первая страница пришла из загрузчика маршрута, а не по сети:
    // до прокрутки страница за историей не ходила.
    expect(historyRequests).toHaveLength(0);

    const thread = container.querySelector('.thread-messages');
    expect(thread).not.toBeNull();

    // В jsdom у элементов нулевые размеры, поэтому лента «не переполнена»
    // и подгрузка не срабатывает — задаём размеры прокручиваемой области явно.
    Object.defineProperty(thread, 'scrollHeight', { value: 4000, configurable: true });
    Object.defineProperty(thread, 'clientHeight', { value: 600, configurable: true });
    (thread as HTMLElement).scrollTop = 0;

    fireEvent.scroll(thread as HTMLElement);

    await waitFor(() => expect(historyRequests).toHaveLength(1));
    expect(historyRequests[0]).toEqual({ offset: '50', limit: '50' });

    // Пришедшая страница встала над уже показанной историей.
    await screen.findByText('старое 1');

    const bubbles = screen.getAllByRole('article');
    expect(bubbles).toHaveLength(PAGE_SIZE + olderMessages.length);
    expect(within(bubbles[0]).getByText('старое 1')).toBeInTheDocument();
    expect(within(bubbles[4]).getByText('старое 5')).toBeInTheDocument();
    expect(within(bubbles[5]).getByText('сообщение 1')).toBeInTheDocument();

    // Одна прокрутка — один запрос: проверяется уже после отрисовки страницы,
    // когда дубль успел бы попасть в список.
    expect(historyRequests).toHaveLength(1);
  });
});

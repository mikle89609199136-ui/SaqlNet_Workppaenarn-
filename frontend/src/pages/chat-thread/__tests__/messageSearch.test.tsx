import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessageSearchStore } from '@/features/message-search';
import { services } from '@/services/serviceContainer';
import { makeChat, makeMessage, makeUser, resetFixtures } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { mockThreadLayout } from '@/test/harness/threadLayout';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { IMessageDto } from '@/types';

const ME = 'user-1';
const PEER = 'user-2';
const PAGE_SIZE = 50;
const START = Date.UTC(2026, 9, 10, 9, 0);
const at = (minute: number) => new Date(START + minute * 60_000).toISOString();

function message(id: string, content: string, minute: number, extra: Partial<IMessageDto> = {}) {
  return makeMessage({
    id,
    chatId: 'chat-search',
    senderId: PEER,
    content,
    createdAt: at(minute),
    ...extra,
  } as never);
}

function open(loaded: IMessageDto[], older: IMessageDto[][] = []) {
  const chat = makeChat({ id: 'chat-search', type: 'private', peerId: PEER });
  const requests: number[] = [];
  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
    http.get(api(`/messages/${chat.id}`), ({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get('offset'));
      requests.push(offset);
      return HttpResponse.json({ messages: older[offset / PAGE_SIZE - 1] ?? [] });
    })
  );
  renderChatThread({ chat, messages: loaded, currentUser: makeUser({ id: ME }) });
  return requests;
}

const filler = (count: number, fromMinute: number) =>
  Array.from({ length: count }, (_, index) =>
    message(`f-${fromMinute + index}`, `сообщение ${fromMinute + index}`, fromMinute + index)
  );

async function search(user: ReturnType<typeof userEvent.setup>, query: string) {
  await user.click(await screen.findByRole('button', { name: 'Поиск по чату' }));
  await user.type(screen.getByRole('searchbox', { name: 'Поиск по переписке' }), query);
}

const counter = () => screen.getByRole('search').querySelector('[aria-live]')?.textContent;
const marks = (id: string) =>
  Array.from(document.getElementById(id)?.querySelectorAll('mark') ?? []);

beforeEach(() => {
  resetFixtures();
  mockThreadLayout({ viewport: 20_000 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('поиск по переписке на клиенте (#841)', () => {
  it('находит в загруженной истории: счётчик, подсветка, текущее — иначе остальных', async () => {
    const user = userEvent.setup();
    open([
      message('m1', 'созвон в пятницу', 1),
      message('m2', 'обычное сообщение', 2),
      message('m3', 'перед созвоном проверь заметки', 3),
    ]);

    await search(user, 'созвон');

    await waitFor(() => expect(counter()).toBe('1 из 2'));
    expect(marks('m3').map((mark) => mark.dataset.current)).toEqual(['true']);
    expect(marks('m1').map((mark) => mark.dataset.current)).toEqual([undefined]);
    expect(marks('m2')).toEqual([]);
  });

  it('стрелки и Enter ходят по совпадениям', async () => {
    const user = userEvent.setup();
    open([message('m1', 'созвон', 1), message('m2', 'созвон', 2), message('m3', 'созвон', 3)]);
    await search(user, 'созвон');
    await waitFor(() => expect(counter()).toBe('1 из 3'));

    await user.keyboard('{Enter}');
    expect(counter()).toBe('2 из 3');
    expect(marks('m2')[0].dataset.current).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Предыдущее совпадение' }));
    expect(counter()).toBe('3 из 3');
    expect(screen.getByRole('button', { name: 'Предыдущее совпадение' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Следующее совпадение' }));
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(counter()).toBe('1 из 3');
  });

  it('находит слово в сообщении, которого нет в загруженной странице', async () => {
    const user = userEvent.setup();
    const requests = open(filler(PAGE_SIZE, 100), [
      [...filler(PAGE_SIZE - 1, 40), message('old', 'старый релиз 2.0', 1)],
      [message('older', 'совсем старое', 0)],
    ]);

    await search(user, 'релиз');

    await waitFor(() => expect(counter()).toBe('1 из 1'));
    expect(requests.slice(0, 2)).toEqual([50, 100]);
    expect(useMessageSearchStore.getState().results.map(({ id }) => id)).toEqual(['old']);
    await waitFor(() => expect(marks('old')[0]?.dataset.current).toBe('true'));
  }, 15_000);

  it('вложения старых страниц не скачиваются — поиску нужен только текст', async () => {
    const user = userEvent.setup();
    const resolveMedia = vi.spyOn(services.messageService, 'resolveMediaForDisplay');
    const requests = open(
      [...filler(PAGE_SIZE - 1, 100), message('fresh', 'релиз вышел', 200)],
      [
        [
          message('photo', 'фото с отпуска', 1, {
            type: 'image',
            metadata: { mediaUrl: '/api/v2/media/00000000-0000-4000-8000-000000000000' },
          } as never),
        ],
      ]
    );

    await search(user, 'релиз');

    await waitFor(() => expect(requests).toEqual([50]));
    await waitFor(() => expect(counter()).toBe('1 из 1'));
    expect(resolveMedia).not.toHaveBeenCalled();
  }, 15_000);

  it('история читается один раз: новый запрос ищет в уже собранном', async () => {
    const user = userEvent.setup();
    const readHistory = vi.spyOn(services.messageService, 'fetchMessageTextsPage');
    open(filler(PAGE_SIZE, 100), [
      [...filler(PAGE_SIZE - 1, 40), message('old', 'старый релиз 2.0', 1)],
      [message('older', 'совсем старое', 0)],
    ]);
    await search(user, 'релиз');
    await waitFor(() => expect(counter()).toBe('1 из 1'));
    expect(readHistory).toHaveBeenCalledTimes(2);

    const field = screen.getByRole('searchbox', { name: 'Поиск по переписке' });
    await user.clear(field);
    await user.type(field, 'совсем');

    await waitFor(() =>
      expect(useMessageSearchStore.getState().results.map(({ id }) => id)).toEqual(['older'])
    );
    expect(readHistory).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('история не дочиталась — счётчик не выдаёт это за «Не найдено»', async () => {
    const user = userEvent.setup();
    const chat = makeChat({ id: 'chat-search', type: 'private', peerId: PEER });
    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.get(api(`/messages/${chat.id}`), () => new HttpResponse(null, { status: 500 }))
    );
    renderChatThread({ chat, messages: filler(PAGE_SIZE, 100), currentUser: makeUser({ id: ME }) });

    await search(user, 'релиз');

    await waitFor(() => expect(counter()).toBe('Не удалось дочитать историю'));
  }, 15_000);

  it('после предела страниц счётчик говорит, сколько просмотрено', async () => {
    const user = userEvent.setup();
    const chat = makeChat({ id: 'chat-search', type: 'private', peerId: PEER });
    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.get(api(`/messages/${chat.id}`), ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'));
        return HttpResponse.json({ messages: filler(PAGE_SIZE, -offset - PAGE_SIZE) });
      })
    );
    renderChatThread({ chat, messages: filler(PAGE_SIZE, 100), currentUser: makeUser({ id: ME }) });

    await search(user, 'релиз');

    await waitFor(() => expect(counter()).toBe('Нет в последних 2050'), { timeout: 20_000 });
  }, 30_000);

  it('нечитаемые сообщения пропускаются без ошибок', async () => {
    const user = userEvent.setup();
    open([
      message('locked', 'созвон', 1, { undecryptable: 'keyUnavailable' } as never),
      message('ok', 'созвон', 2),
    ]);

    await search(user, 'созвон');

    await waitFor(() => expect(counter()).toBe('1 из 1'));
    expect(useMessageSearchStore.getState().results.map(({ id }) => id)).toEqual(['ok']);
  });

  it('ничего не найдено — так и сказано', async () => {
    const user = userEvent.setup();
    open([message('m1', 'привет', 1)]);

    await search(user, 'созвон');

    await waitFor(() => expect(counter()).toBe('Не найдено'));
  });

  it('закрытие отменяет догрузку и стирает найденное', async () => {
    const user = userEvent.setup();
    const pending: Array<() => void> = [];
    const chat = makeChat({ id: 'chat-search', type: 'private', peerId: PEER });
    const requests: number[] = [];
    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.get(api(`/messages/${chat.id}`), async ({ request }) => {
        requests.push(Number(new URL(request.url).searchParams.get('offset')));
        await new Promise<void>((resolve) => pending.push(resolve));
        return HttpResponse.json({
          messages: [...filler(PAGE_SIZE - 1, 20), message('old', 'релиз', 1)],
        });
      })
    );
    renderChatThread({ chat, messages: filler(PAGE_SIZE, 100), currentUser: makeUser({ id: ME }) });

    await search(user, 'релиз');
    await waitFor(() => expect(requests).toEqual([50]));
    expect(counter()).toBe('Ищем…');

    await user.click(screen.getByRole('button', { name: 'Закрыть поиск' }));
    await act(async () => pending.splice(0).forEach((resolve) => resolve()));

    expect(useMessageSearchStore.getState()).toMatchObject({ chatId: null, results: [] });
    expect(requests).toEqual([50]);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  }, 15_000);
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { makeChat, makeMessage } from '@/test/fixtures';
import { chatKeys } from '@/entities/chat';
import { useServerEvents } from '@/realtime/useServerEvents';
import { mockChatListLayout } from '@/test/harness/chatListLayout';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { scrollElementTo } from '@/test/harness/virtualLayout';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { IChatDto } from '@/types';
import { ChatsList } from './ChatsList';

/* Состояние связи подменяется: заголовок списка обязан его отражать. */
const connection = vi.hoisted(() => ({
  status: 'connected' as 'connected' | 'connecting' | 'offline',
}));
vi.mock('@/shared/lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConnectionStatus: () => connection.status,
}));

function renderChatsList(
  onOpenCreateGroup = vi.fn(),
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter initialEntries={['/chats']}>
          <ChatsList onOpenCreateGroup={onOpenCreateGroup} />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('ChatsList widget', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.restoreAllMocks();
  });

  it('рендерит поле поиска', () => {
    queryClient.setQueryData(chatKeys.list(), []);
    queryClient.setQueryData(chatKeys.archived(), []);

    renderChatsList(vi.fn(), queryClient);

    expect(screen.getByRole('searchbox', { name: /поиск/i })).toBeInTheDocument();
  });

  it('новая группа создаётся из вкладки «Группы», а не из общего списка', () => {
    queryClient.setQueryData(chatKeys.list(), []);
    queryClient.setQueryData(chatKeys.archived(), []);
    const onOpenCreateGroup = vi.fn();

    renderChatsList(onOpenCreateGroup, queryClient);

    expect(screen.queryByRole('button', { name: 'Новая группа' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Группы' }));
    // Кнопка есть и тогда, когда групп ещё нет: с неё первая и начинается.
    expect(screen.getByText('Групп пока нет')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Новая группа' }));

    expect(onOpenCreateGroup).toHaveBeenCalledTimes(1);
  });

  it('отображает плейсхолдер пустого списка при отсутствии начатых чатов', () => {
    queryClient.setQueryData(chatKeys.list(), []);
    queryClient.setQueryData(chatKeys.archived(), []);

    renderChatsList(vi.fn(), queryClient);

    expect(screen.getByText('Чатов пока нет')).toBeInTheDocument();
  });

  it('отображает список чатов, если чаты начаты', () => {
    const chat1 = makeChat({
      id: 'c-1',
      title: 'Чат 1',
      lastMessage: makeMessage({ content: 'Привет' }),
    });
    queryClient.setQueryData(chatKeys.list(), [chat1]);
    queryClient.setQueryData(chatKeys.archived(), []);

    renderChatsList(vi.fn(), queryClient);

    expect(screen.getByText('Чат 1')).toBeInTheDocument();
  });

  /* Разделы — вкладки списка (#818). */
  describe('вкладки разделов', () => {
    const personal = makeChat({
      id: 'c-1',
      title: 'Вася',
      type: 'private',
      lastMessage: makeMessage({ content: 'Привет' }),
    });
    const group = makeChat({
      id: 'c-2',
      title: 'Команда',
      type: 'group',
      lastMessage: makeMessage({ content: 'Всем привет' }),
    });
    const archived = makeChat({
      id: 'c-arch',
      title: 'Архивный чат',
      archived: true,
      lastMessage: makeMessage({ content: 'В архиве' }),
    });

    beforeEach(() => {
      queryClient.setQueryData(chatKeys.list(), [personal, group]);
      queryClient.setQueryData(chatKeys.archived(), [archived]);
    });

    it('показывает Чаты, Группы и Архив; каналов и встреч пока нет', () => {
      renderChatsList(vi.fn(), queryClient);

      const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
      expect(tabs).toEqual(['Чаты', 'Группы', 'Архив']);
      expect(screen.getByRole('tab', { name: 'Чаты' })).toHaveAttribute('aria-selected', 'true');
    });

    it('панель вкладки названа выбранной вкладкой', () => {
      renderChatsList(vi.fn(), queryClient);

      expect(screen.getByRole('tabpanel', { name: 'Чаты' })).toBeInTheDocument();
    });

    it('в «Чатах» все переписки, в «Группах» — только группы', () => {
      renderChatsList(vi.fn(), queryClient);

      expect(screen.getByText('Вася')).toBeInTheDocument();
      expect(screen.getByText('Команда')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Группы' }));

      expect(screen.getByRole('tabpanel', { name: 'Группы' })).toBeInTheDocument();
      expect(screen.queryByText('Вася')).not.toBeInTheDocument();
      expect(screen.getByText('Команда')).toBeInTheDocument();
    });

    it('в «Архиве» — архивные чаты и пояснение, что это за раздел', () => {
      renderChatsList(vi.fn(), queryClient);

      fireEvent.click(screen.getByRole('tab', { name: 'Архив' }));

      expect(
        screen.getByText('Здесь чаты, которые вы убрали из основного списка.')
      ).toBeInTheDocument();
      expect(screen.getByText('Архивный чат')).toBeInTheDocument();
      expect(screen.queryByText('Вася')).not.toBeInTheDocument();
    });

    it('пустой архив — это сообщение, а не пустота', () => {
      queryClient.setQueryData(chatKeys.archived(), []);
      renderChatsList(vi.fn(), queryClient);

      fireEvent.click(screen.getByRole('tab', { name: 'Архив' }));

      expect(screen.getByText('В архиве пусто')).toBeInTheDocument();
    });

    it('вкладки переключаются стрелками', () => {
      renderChatsList(vi.fn(), queryClient);

      const chats = screen.getByRole('tab', { name: 'Чаты' });
      chats.focus();
      fireEvent.keyDown(chats, { key: 'ArrowRight' });

      const groups = screen.getByRole('tab', { name: 'Группы' });
      expect(groups).toHaveFocus();
      expect(groups).toHaveAttribute('aria-selected', 'true');

      fireEvent.keyDown(groups, { key: 'End' });
      expect(screen.getByRole('tab', { name: 'Архив' })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('настройки открываются кнопкой в шапке списка', () => {
    queryClient.setQueryData(chatKeys.list(), []);
    queryClient.setQueryData(chatKeys.archived(), []);

    renderChatsList(vi.fn(), queryClient);

    expect(screen.getByRole('heading', { name: 'Сообщения' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Настройки' })).toHaveAttribute('href', '/settings');
  });

  it('закреплённые идут первыми, без отдельного раздела', () => {
    // Закреплённый во входных данных вторым: наверх его поднимает сам список.
    queryClient.setQueryData(chatKeys.list(), [
      makeChat({ id: 'c-2', title: 'Петя', lastMessage: makeMessage({ content: 'б' }) }),
      makeChat({
        id: 'c-1',
        title: 'Вася',
        isPinned: true,
        lastMessage: makeMessage({ content: 'а' }),
      }),
    ]);
    queryClient.setQueryData(chatKeys.archived(), []);

    renderChatsList(vi.fn(), queryClient);

    const names = screen
      .getAllByRole('link', { name: /Вася|Петя/ })
      .map((link) => link.textContent);
    expect(names[0]).toMatch(/Вася/);
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it.each([
    ['connected', 'Сообщения'],
    ['connecting', 'Соединение…'],
    ['offline', 'Ожидание сети…'],
  ] as const)('заголовок при связи «%s» — «%s»', (status, title) => {
    connection.status = status;
    queryClient.setQueryData(chatKeys.list(), []);
    queryClient.setQueryData(chatKeys.archived(), []);

    renderChatsList(vi.fn(), queryClient);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
    connection.status = 'connected';
  });

  describe('виртуальный список (#946)', () => {
    const ROW = 66;
    const START = Date.UTC(2026, 9, 1, 12, 0);
    const minutesAgo = (minutes: number) => new Date(START - minutes * 60_000).toISOString();

    const group = (index: number, extra: Partial<IChatDto> = {}) =>
      makeChat({
        id: `g-${index}`,
        title: `Группа ${index}`,
        type: 'group',
        lastMessageAt: minutesAgo(index) as never,
        ...extra,
      });

    const groups = (count: number) => Array.from({ length: count }, (_, index) => group(index + 1));

    function ServerEvents() {
      useServerEvents(true);
      return null;
    }

    function renderList(chats: IChatDto[], { path = '/chats', archived = [] as IChatDto[] } = {}) {
      queryClient.setQueryData(chatKeys.list(), chats);
      queryClient.setQueryData(chatKeys.archived(), archived);
      render(
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={testI18n}>
            <MemoryRouter initialEntries={[path]}>
              <ServerEvents />
              <ChatsList onOpenCreateGroup={vi.fn()} />
            </MemoryRouter>
          </I18nextProvider>
        </QueryClientProvider>
      );
      return screen.getByRole('tabpanel');
    }

    const titleOf = (link: HTMLElement) =>
      Array.from(link.querySelectorAll('span'), (span) => span.textContent).find((text) =>
        /^Группа \d+$/.test(text ?? '')
      );

    const rowNames = (panel: HTMLElement) => within(panel).queryAllByRole('link').map(titleOf);

    const rowLink = (title: string) => screen.queryByText(title, { exact: true })?.closest('a');

    beforeEach(() => {
      mockChatListLayout({ viewport: 600, row: ROW });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('из 200 чатов в DOM только видимые строки и запас, первая — первый чат', () => {
      const panel = renderList(groups(200));

      const names = rowNames(panel);
      expect(names.length).toBeGreaterThan(0);
      expect(names.length).toBeLessThan(40);
      expect(names[0]).toBe('Группа 1');
    });

    it('прокрутка в конец — отрисованы последние чаты', () => {
      const panel = renderList(groups(200));

      scrollElementTo(panel, 200 * ROW);

      expect(rowNames(panel)).toContain('Группа 200');
      expect(rowNames(panel)).not.toContain('Группа 1');
      expect(rowLink('Группа 200')).toBeInTheDocument();
    });

    it('новое сообщение поднимает чат из конца списка первой строкой, без дублей', async () => {
      const chats = groups(200);
      const panel = renderList(chats);
      const raised = { ...chats[199], lastMessageAt: minutesAgo(-1) as never };
      server.use(
        http.get(api('/chats'), ({ request }) =>
          HttpResponse.json({
            chats: new URL(request.url).searchParams.get('archived')
              ? []
              : [raised, ...chats.slice(0, 199)],
          })
        )
      );

      await act(async () => {
        fakeSocket.emit('new_message', {
          chatId: raised.id,
          message: makeMessage({ chatId: raised.id, senderId: 'user-2' }),
        });
      });

      await waitFor(() => expect(rowNames(panel)[0]).toBe('Группа 200'));
      const names = rowNames(panel);
      expect(new Set(names).size).toBe(names.length);
    });

    it('закреплённый первым и после прокрутки туда и обратно', () => {
      const chats = groups(200);
      chats[149] = group(150, { isPinned: true });
      const panel = renderList(chats);

      expect(rowNames(panel)[0]).toBe('Группа 150');
      scrollElementTo(panel, 200 * ROW);
      scrollElementTo(panel, 0);

      expect(rowNames(panel)[0]).toBe('Группа 150');
    });

    it('«Группы»: первой «Новая группа», за ней группы', () => {
      renderList(groups(50));

      fireEvent.click(screen.getByRole('tab', { name: 'Группы' }));

      const create = screen.getByRole('button', { name: 'Новая группа' });
      const first = rowLink('Группа 1')!;
      expect(create.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('«Архив»: заметка, за ней чаты архива', () => {
      renderList([], { archived: [group(7, { isArchived: true })] });

      fireEvent.click(screen.getByRole('tab', { name: 'Архив' }));

      const note = screen.getByText('Здесь чаты, которые вы убрали из основного списка.');
      const row = rowLink('Группа 7')!;
      expect(note.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('смена вкладки открывает список с начала', () => {
      const panel = renderList(groups(200));
      scrollElementTo(panel, 150 * ROW);

      fireEvent.click(screen.getByRole('tab', { name: 'Группы' }));

      expect(screen.getByRole('tabpanel').scrollTop).toBe(0);
      expect(screen.getByRole('button', { name: 'Новая группа' })).toBeInTheDocument();
      expect(rowNames(screen.getByRole('tabpanel'))[0]).toBe('Группа 1');
    });

    it('открытый чат подсвечен и после прокрутки туда и обратно', () => {
      const panel = renderList(groups(200), { path: '/chats/g-3' });
      const current = () => rowLink('Группа 3');

      expect(current()).toHaveAttribute('aria-current', 'page');
      scrollElementTo(panel, 200 * ROW);
      expect(current()).toBeFalsy();
      scrollElementTo(panel, 0);

      expect(current()).toHaveAttribute('aria-current', 'page');
    });

    it('правая кнопка открывает меню строки, прокрутка его закрывает', () => {
      const panel = renderList(groups(200));

      fireEvent.contextMenu(rowLink('Группа 2')!);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      scrollElementTo(panel, 10 * ROW);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { makeChat, makeMessage } from '@/test/fixtures';
import { chatKeys } from '@/entities/chat';
import { ChatsList } from './ChatsList';

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

  it('рендерит поле поиска и кнопку новой группы', () => {
    queryClient.setQueryData(chatKeys.list(), []);
    queryClient.setQueryData(chatKeys.archived(), []);
    const onOpenCreateGroup = vi.fn();

    renderChatsList(onOpenCreateGroup, queryClient);

    expect(screen.getByRole('searchbox', { name: /поиск/i })).toBeInTheDocument();
    const newGroupBtn = screen.getByRole('button', { name: /Новая группа/i });
    expect(newGroupBtn).toBeInTheDocument();

    fireEvent.click(newGroupBtn);
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
});

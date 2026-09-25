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

  it('показывает блок архива и переключается на архив при клике', () => {
    const normalChat = makeChat({
      id: 'c-1',
      title: 'Обычный чат',
      lastMessage: makeMessage({ content: 'Привет' }),
    });
    const archivedChat = makeChat({
      id: 'c-arch',
      title: 'Архивный чат',
      archived: true,
      lastMessage: makeMessage({ content: 'В архиве' }),
    });

    queryClient.setQueryData(chatKeys.list(), [normalChat]);
    queryClient.setQueryData(chatKeys.archived(), [archivedChat]);

    renderChatsList(vi.fn(), queryClient);

    // В списке есть вход в архив
    const archiveButton = screen.getByRole('button', { name: /Архив/i });
    expect(archiveButton).toBeInTheDocument();

    // Кликаем по архиву
    fireEvent.click(archiveButton);

    // Отображается экран архива
    expect(screen.getByRole('heading', { name: 'Архив' })).toBeInTheDocument();
    expect(screen.getByText('Архивный чат')).toBeInTheDocument();

    // Нажимаем Назад
    const backBtn = screen.getByRole('button', { name: 'Назад' });
    fireEvent.click(backBtn);

    // Возвращаемся в обычный список
    expect(screen.getByText('Обычный чат')).toBeInTheDocument();
  });
});

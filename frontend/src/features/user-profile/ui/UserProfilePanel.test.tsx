import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { ProfileDetails } from './ProfileDetails';
import { ProfileHeader, useProfileStore } from '@/entities/user';
import { useChatUiStore } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { UserProfilePanel } from './UserProfilePanel';

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

function renderPanelWithProviders(ui: React.ReactElement, path = '/chats') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              element={
                <>
                  {ui}
                  <CurrentPath />
                </>
              }
              path="*"
            />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

describe('UserProfile subcomponents and UserProfilePanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('ProfileHeader', () => {
    it('рендерит профиль собеседника с кнопками аудио и видео звонков', async () => {
      const peer = makeUser({ id: 'user-2', username: 'peer_user', firstName: 'Алексей' });
      const onCall = vi.fn();
      const onStartEdit = vi.fn();

      renderWithI18n(
        <ProfileHeader
          hasChat={true}
          isMyProfile={false}
          isPeerOnline={true}
          onCall={onCall}
          onStartEdit={onStartEdit}
          profileSubtitle="в сети"
          profileUser={peer}
        />
      );

      expect(screen.getByRole('heading', { level: 2, name: 'Алексей' })).toBeInTheDocument();
      expect(screen.getByText('в сети')).toBeInTheDocument();

      const phoneBtn = screen.getByRole('button', { name: /аудиозвонок/i });
      const videoBtn = screen.getByRole('button', { name: /видеозвонок/i });
      expect(phoneBtn).toBeInTheDocument();
      expect(videoBtn).toBeInTheDocument();

      await userEvent.click(phoneBtn);
      expect(onCall).toHaveBeenCalledWith('audio');

      await userEvent.click(videoBtn);
      expect(onCall).toHaveBeenCalledWith('video');
      // Плитки — как в макете: короткие подписи «Звонок» и «Видео».
      expect(phoneBtn).toHaveTextContent('Звонок');
      expect(videoBtn).toHaveTextContent('Видео');
    });

    it('для своего профиля показывает кнопку редактирования', async () => {
      const me = makeUser({ id: 'user-1', username: 'my_user', firstName: 'Я' });
      const onStartEdit = vi.fn();

      renderWithI18n(
        <ProfileHeader
          hasChat={false}
          isMyProfile={true}
          isPeerOnline={false}
          onCall={vi.fn()}
          onStartEdit={onStartEdit}
          profileSubtitle={null}
          profileUser={me}
        />
      );

      const editBtn = screen.getByRole('button', { name: /редактировать/i });
      expect(editBtn).toBeInTheDocument();
      await userEvent.click(editBtn);
      expect(onStartEdit).toHaveBeenCalled();
    });
  });

  describe('ProfileDetails', () => {
    it('отображает данные в режиме просмотра', () => {
      const user = makeUser({ firstName: 'Иван', bio: 'Привет миру', username: 'ivan' });

      renderWithI18n(
        <ProfileDetails
          editDraft={{ firstName: 'Иван', bio: 'Привет миру' }}
          editError=""
          isEditing={false}
          isSaving={false}
          onCancelEdit={vi.fn()}
          onDraftChange={vi.fn()}
          onSave={vi.fn()}
          profileUser={user}
        />
      );

      // Имя и ник — в шапке профиля; здесь — только «О себе», как в макете.
      expect(screen.getByText('О себе')).toBeInTheDocument();
      expect(screen.getByText('Привет миру')).toBeInTheDocument();
    });

    it('без «О себе» блок не показывается', () => {
      const user = makeUser({ firstName: 'Иван', bio: '' });

      const { container } = renderWithI18n(
        <ProfileDetails
          editDraft={{ firstName: 'Иван', bio: '' }}
          editError=""
          isEditing={false}
          isSaving={false}
          onCancelEdit={vi.fn()}
          onDraftChange={vi.fn()}
          onSave={vi.fn()}
          profileUser={user}
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('в режиме редактирования позволяет менять поля и отправлять форму', async () => {
      const user = makeUser({ firstName: 'Иван', bio: 'Привет', username: 'ivan' });
      const onSave = vi.fn((e) => {
        e.preventDefault();
        return Promise.resolve();
      });
      const onCancel = vi.fn();
      const onDraftChange = vi.fn();

      renderWithI18n(
        <ProfileDetails
          editDraft={{ firstName: 'Иван Новый', bio: 'Новое био' }}
          editError=""
          isEditing={true}
          isSaving={false}
          onCancelEdit={onCancel}
          onDraftChange={onDraftChange}
          onSave={onSave}
          profileUser={user}
        />
      );

      const inputs = screen.getAllByRole('textbox');
      expect(inputs).toHaveLength(2);

      const saveBtn = screen.getByRole('button', { name: /сохранить/i });
      const cancelBtn = screen.getByRole('button', { name: /отмена/i });

      await userEvent.click(saveBtn);
      expect(onSave).toHaveBeenCalled();

      await userEvent.click(cancelBtn);
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('UserProfilePanel', () => {
    it('показывает состояние загрузки и ошибку при сбое', async () => {
      server.use(
        http.get(api('/users/:userId/profile'), () =>
          HttpResponse.json({ message: 'Error' }, { status: 500 })
        )
      );

      renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{
            isOpen: true,
            userId: 'user-999',
            chat: null,
          }}
        />
      );

      expect(screen.getByText(/загрузка/i)).toBeInTheDocument();
      expect(await screen.findByText(/не удалось загрузить профиль/i)).toBeInTheDocument();
    });

    it('рендерит профиль пользователя при успешной загрузке', async () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      server.use(http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: peer })));
      useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });

      const chat = makeChat({ id: 'chat-1', type: 'private', peerId: 'user-2' });

      renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{
            isOpen: true,
            userId: 'user-2',
            chat,
          }}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Алексей' })).toBeInTheDocument();
      expect(screen.getAllByText(/alex/).length).toBeGreaterThan(0);
      expect(await screen.findByRole('button', { name: /аудиозвонок/i })).toBeInTheDocument();
    });

    it('звонок приходит сверху пропом и получает чат, собеседника и вид (#863)', async () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      server.use(
        http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: peer })),
        http.get(api('/users/blocked'), () => HttpResponse.json({ blocked: null }))
      );
      useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });
      const chat = makeChat({ id: 'chat-1', type: 'private', peerId: 'user-2' });
      const startCall = vi.fn();

      renderPanelWithProviders(
        <UserProfilePanel
          onClose={vi.fn()}
          profileState={{ isOpen: true, userId: 'user-2', chat }}
          startCall={startCall}
        />
      );
      await userEvent.click(await screen.findByRole('button', { name: /видеозвонок/i }));

      expect(startCall).toHaveBeenCalledWith({
        chatId: 'chat-1',
        peerId: 'user-2',
        peerName: 'alex',
        kind: 'video',
      });
    });

    it('звонки выключены (#776) — кнопок звонка в профиле нет', async () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      server.use(
        http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: peer })),
        http.get(api('/users/blocked'), () => HttpResponse.json({ blocked: null }))
      );
      useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });
      const chat = makeChat({ id: 'chat-1', type: 'private', peerId: 'user-2' });

      renderPanelWithProviders(
        <UserProfilePanel
          onClose={vi.fn()}
          profileState={{ isOpen: true, userId: 'user-2', chat }}
        />
      );
      await screen.findByText('Алексей');
      expect(screen.queryByRole('button', { name: /аудиозвонок/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /видеозвонок/i })).not.toBeInTheDocument();
    });

    it('при блокировке звонок из профиля неактивен (#760)', async () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      server.use(
        http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: peer })),
        http.get(api('/users/blocked'), () => HttpResponse.json({ blocked: null }))
      );
      useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });
      const chat = makeChat({
        id: 'chat-1',
        type: 'private',
        peerId: 'user-2',
        isBlockedByPeer: true,
      });

      renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{ isOpen: true, userId: 'user-2', chat }}
        />
      );

      expect(await screen.findByRole('button', { name: /аудиозвонок/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /видеозвонок/i })).toBeDisabled();
    });

    it('действия с профилем приходят сверху: только для чужого (#727)', async () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      const me = makeUser({ id: 'user-1', username: 'me', firstName: 'Я' });
      server.use(
        http.get(api('/users/:userId/profile'), ({ params }) =>
          HttpResponse.json({ user: params.userId === 'user-1' ? me : peer })
        )
      );
      useProfileStore.setState({ user: me });
      const renderActions = vi.fn(() => <button type="button">Действие</button>);

      const { unmount } = renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{ isOpen: true, userId: 'user-2', chat: null }}
          renderActions={renderActions}
        />
      );
      expect(await screen.findByRole('button', { name: 'Действие' })).toBeInTheDocument();
      expect(renderActions).toHaveBeenCalledWith({ id: 'user-2', name: 'Алексей Пользователь' });
      unmount();
      renderActions.mockClear();

      renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{ isOpen: true, userId: 'user-1', chat: null }}
          renderActions={renderActions}
        />
      );
      expect(await screen.findByRole('heading', { level: 2, name: 'Я' })).toBeInTheDocument();
      expect(renderActions).not.toHaveBeenCalled();
    });

    it('профиль из пересланного сообщения не берёт чужой чат (#785)', async () => {
      const author = makeUser({ id: 'user-3', username: 'anna', firstName: 'Анна' });
      server.use(
        http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: author }))
      );
      useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });

      // Открыт чат с user-2, а профиль — автора пересланного, user-3.
      const chat = makeChat({
        id: 'chat-1',
        type: 'private',
        peerId: 'user-2',
        peerIsOnline: true,
      });

      renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{ isOpen: true, userId: 'user-3', chat }}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Анна' })).toBeInTheDocument();
      // Ни статуса, ни звонка, ни общих медиа чужого собеседника.
      expect(screen.queryByText('онлайн')).not.toBeInTheDocument();
      // Звонить некуда: общего личного чата нет — кнопка неактивна.
      expect(screen.getByRole('button', { name: /аудиозвонок/i })).toBeDisabled();
      expect(screen.queryByRole('tab', { name: 'Медиа' })).not.toBeInTheDocument();
    });

    it('отображает онлайн статус при получении isOnline: true', async () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      server.use(
        http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: peer })),
        http.get(api('/users/:userId/status'), () =>
          HttpResponse.json({ isOnline: true, lastSeen: '' })
        )
      );
      useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });

      renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{
            isOpen: true,
            userId: 'user-2',
            chat: null,
          }}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Алексей' })).toBeInTheDocument();
      expect(await screen.findByText('онлайн')).toBeInTheDocument();
    });

    it('отображает последнее посещение при получении isOnline: false', async () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      server.use(
        http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: peer })),
        http.get(api('/users/:userId/status'), () =>
          HttpResponse.json({ isOnline: false, lastSeen: new Date().toISOString() })
        )
      );
      useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });

      renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{
            isOpen: true,
            userId: 'user-2',
            chat: null,
          }}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Алексей' })).toBeInTheDocument();
      expect(await screen.findByText('был(а) только что')).toBeInTheDocument();
    });

    it('отображает приблизительное время при скрытом lastSeen (#791)', async () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      server.use(
        http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: peer })),
        http.get(api('/users/:userId/status'), () =>
          HttpResponse.json({ isOnline: false, lastSeen: '', lastSeenApprox: 'within_week' })
        )
      );
      useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });

      renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{
            isOpen: true,
            userId: 'user-2',
            chat: null,
          }}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Алексей' })).toBeInTheDocument();
      expect(await screen.findByText('был(а) на этой неделе')).toBeInTheDocument();
    });

    it('при личном чате запрос /status не выполняется, статус берётся из чата', async () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      let statusCalled = false;
      server.use(
        http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: peer })),
        http.get(api('/users/:userId/status'), () => {
          statusCalled = true;
          return HttpResponse.json({ isOnline: false, lastSeen: '' });
        })
      );
      useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });
      const chat = makeChat({
        id: 'chat-1',
        type: 'private',
        peerId: 'user-2',
        peerIsOnline: true,
      });

      renderPanelWithProviders(
        <UserProfilePanel
          startCall={vi.fn()}
          onClose={vi.fn()}
          profileState={{
            isOpen: true,
            userId: 'user-2',
            chat,
          }}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Алексей' })).toBeInTheDocument();
      expect(screen.getByText('онлайн')).toBeInTheDocument();
      expect(statusCalled).toBe(false);
    });

    /* «Перейти к сообщению» из общего (#842): запрос берёт лента чата. */
    describe('переход к сообщению из общего', () => {
      const peer = makeUser({ id: 'user-2', username: 'alex', firstName: 'Алексей' });
      const chat = makeChat({ id: 'chat-1', type: 'private', peerId: 'user-2' });

      async function jumpFromMedia() {
        vi.spyOn(services.messageService, 'fetchSharedPage').mockResolvedValue({
          messages: [{ ...makeMessage({ id: 'msg-9', type: 'image' }), mediaUrl: 'blob:p' }],
        });
        fireEvent.contextMenu(await screen.findByRole('button', { name: 'Изображение' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Перейти к сообщению' }));
      }

      beforeEach(() => {
        server.use(
          http.get(api('/users/:userId/profile'), () => HttpResponse.json({ user: peer }))
        );
        useProfileStore.setState({ user: makeUser({ id: 'user-1' }) });
        useChatUiStore.setState({ jumpRequest: null });
      });

      it('в открытом чате — запрос ленте, панель остаётся', async () => {
        const onClose = vi.fn();
        renderPanelWithProviders(
          <UserProfilePanel
            onClose={onClose}
            profileState={{ isOpen: true, userId: 'user-2', chat }}
          />,
          '/chats/chat-1'
        );
        await jumpFromMedia();

        expect(useChatUiStore.getState().jumpRequest).toEqual({
          chatId: 'chat-1',
          messageId: 'msg-9',
        });
        expect(screen.getByTestId('path')).toHaveTextContent('/chats/chat-1');
        expect(onClose).not.toHaveBeenCalled();
      });

      it('открыт другой чат (участник группы) — переход в личный', async () => {
        renderPanelWithProviders(
          <UserProfilePanel
            onClose={vi.fn()}
            profileState={{ isOpen: true, userId: 'user-2', chat }}
          />,
          '/chats/group-1'
        );
        await jumpFromMedia();

        expect(screen.getByTestId('path')).toHaveTextContent('/chats/chat-1');
        expect(useChatUiStore.getState().jumpRequest?.messageId).toBe('msg-9');
      });

      it('окном поверх переписки (телефон) — профиль закрывается', async () => {
        const onClose = vi.fn();
        renderPanelWithProviders(
          <UserProfilePanel
            closeOnJump
            onClose={onClose}
            profileState={{ isOpen: true, userId: 'user-2', chat }}
          />,
          '/chats/chat-1'
        );
        await jumpFromMedia();

        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });
  });
});

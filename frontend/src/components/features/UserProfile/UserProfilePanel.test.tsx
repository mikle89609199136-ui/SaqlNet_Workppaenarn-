import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import type { IMediaItem } from '@/types';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { useProfileStore } from '@/store';
import { ProfileDetails } from './ProfileDetails';
import { ProfileHeader } from './ProfileHeader';
import { isDisplayableMedia, ProfileSharedMedia } from './ProfileSharedMedia';
import { UserProfilePanel } from './UserProfilePanel';

function makeMediaMessage(
  id: string,
  type: 'image' | 'video',
  mediaUrl: string | null
): IMediaItem {
  return { ...makeMessage({ id, type }), mediaUrl };
}

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

function renderPanelWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('UserProfile subcomponents and UserProfilePanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('ProfileHeader', () => {
    it('рендерит профиль собеседника с кнопками аудио и видео звонков', async () => {
      const peer = makeUser({ id: 'user-2', username: 'peer_user', firstName: 'Алексей' });
      const onCall = vi.fn();
      const onClose = vi.fn();
      const onStartEdit = vi.fn();

      renderWithI18n(
        <ProfileHeader
          hasChat={true}
          isMyProfile={false}
          isPeerOnline={true}
          onCall={onCall}
          onClose={onClose}
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

      const closeBtn = screen.getByRole('button', { name: /закрыть/i });
      await userEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
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
          onClose={vi.fn()}
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

      expect(screen.getByText('Иван')).toBeInTheDocument();
      expect(screen.getByText('Привет миру')).toBeInTheDocument();
      expect(screen.getByText(/ivan/)).toBeInTheDocument();
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

  describe('ProfileSharedMedia', () => {
    it('показывает заглушку при отсутствии медиа', () => {
      renderWithI18n(<ProfileSharedMedia sharedMedia={[]} />);
      expect(screen.getByText(/медиафайлы отсутствуют/i)).toBeInTheDocument();
    });

    it('рендерит изображения и видео при их наличии', () => {
      /* Адрес берётся с самого сообщения: он появляется после
         расшифровки. В `metadata.mediaUrl` лежит эндпойнт с шифровкой,
         картинкой он не отдаётся. */
      const imgMsg = makeMediaMessage('msg-1', 'image', 'blob:crane/photo');
      const videoMsg = makeMediaMessage('msg-2', 'video', 'blob:crane/video');

      renderWithI18n(<ProfileSharedMedia sharedMedia={[imgMsg, videoMsg]} />);

      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(2);
      expect(links[0]).toHaveAttribute('href', 'blob:crane/photo');
      expect(links[1]).toHaveAttribute('href', 'blob:crane/video');
    });
  });

  describe('isDisplayableMedia', () => {
    it('пропускает расшифрованное изображение и видео', () => {
      expect(isDisplayableMedia(makeMediaMessage('msg-1', 'image', 'blob:crane/photo'))).toBe(true);
      expect(isDisplayableMedia(makeMediaMessage('msg-2', 'video', 'blob:crane/video'))).toBe(true);
    });

    it('отсеивает вложение без пригодного адреса', () => {
      const notDecrypted = makeMediaMessage('msg-3', 'image', null);
      expect(isDisplayableMedia(notDecrypted)).toBe(false);
    });

    it('отсеивает вложение, помеченное недоступным', () => {
      const unavailable: IMediaItem = {
        ...makeMediaMessage('msg-4', 'image', 'blob:crane/legacy'),
        mediaUnavailable: true,
      };
      expect(isDisplayableMedia(unavailable)).toBe(false);
    });

    it('отсеивает текстовое сообщение', () => {
      expect(isDisplayableMedia(makeMessage({ id: 'msg-5', type: 'text' }))).toBe(false);
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
          onClose={vi.fn()}
          profileState={{
            isOpen: true,
            userId: 'user-999',
            chat: null,
            messages: [],
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
          onClose={vi.fn()}
          profileState={{
            isOpen: true,
            userId: 'user-2',
            chat,
            messages: [],
          }}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Алексей' })).toBeInTheDocument();
      expect(screen.getAllByText(/alex/).length).toBeGreaterThan(0);
      expect(await screen.findByRole('button', { name: /аудиозвонок/i })).toBeInTheDocument();
    });
  });
});

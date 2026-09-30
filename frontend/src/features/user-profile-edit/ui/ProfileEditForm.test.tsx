import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { useProfileStore, userKeys, MAX_AVATAR_SIZE_BYTES } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { testI18n } from '@/test/harness/i18n';
import { makeUser } from '@/test/fixtures';
import { ToastStack } from '@/shared/ui';
import type { IUserDto } from '@/types';
import { ProfileEditForm } from './ProfileEditForm';

const INITIAL_USER: IUserDto = makeUser({
  id: 'user-485',
  username: 'avatar_tester',
  firstName: 'Иван',
  lastName: 'Тестеров',
  avatarUrl: 'https://example.com/initial.jpg',
});

function renderForm(user: Partial<IUserDto> = INITIAL_USER, onBack = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(userKeys.me(), user);
  useProfileStore.setState({ user: user as IUserDto, isAuth: true });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastStack />
        <ProfileEditForm onBack={onBack} user={user} />
      </I18nextProvider>
    </QueryClientProvider>
  );

  return { ...result, queryClient };
}

describe('ProfileEditForm: загрузка фото профиля (#485)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('кнопка «Изменить фото» активна и запускает выбор файла', async () => {
    renderForm();

    const changeBtn = screen.getByRole('button', { name: /Изменить фото/i });
    expect(changeBtn).toBeEnabled();

    const fileInput = screen.getByTestId('avatar-file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    await userEvent.click(changeBtn);
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('отклоняет файл неверного формата и не отправляет сетевые запросы', async () => {
    const uploadSpy = vi.spyOn(services.mediaService, 'upload');
    renderForm();

    const fileInput = screen.getByTestId('avatar-file-input');
    const invalidFile = new File(['text content'], 'notes.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(await screen.findByText(/Поддерживаются только изображения/i)).toBeInTheDocument();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('отклоняет файл более 5 МБ и не отправляет сетевые запросы', async () => {
    const uploadSpy = vi.spyOn(services.mediaService, 'upload');
    renderForm();

    const fileInput = screen.getByTestId('avatar-file-input');
    const largeBlob = new Uint8Array(MAX_AVATAR_SIZE_BYTES + 10);
    const largeFile = new File([largeBlob], 'huge.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    expect(
      await screen.findByText(/Файл слишком большой. Максимальный размер 5 МБ/i)
    ).toBeInTheDocument();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('выполняет полный сценарий загрузки: предпросмотр, отправка, сохранение и обновление кеша', async () => {
    const mockCreatedBlobUrl = 'blob:http://localhost:3000/avatar-preview-id';
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockCreatedBlobUrl);
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    const uploadedMediaUrl = '/api/v2/media/uploaded-avatar-uuid';
    const uploadSpy = vi
      .spyOn(services.mediaService, 'upload')
      .mockResolvedValue({ url: uploadedMediaUrl, success: true });

    const updatedUser: IUserDto = {
      ...INITIAL_USER,
      avatarUrl: uploadedMediaUrl,
    };
    const updateAvatarSpy = vi
      .spyOn(services.userService, 'updateAvatar')
      .mockResolvedValue(updatedUser);

    const { container, queryClient } = renderForm();

    const fileInput = screen.getByTestId('avatar-file-input');
    const validFile = new File(['avatar binary'], 'new-avatar.png', { type: 'image/png' });

    await userEvent.upload(fileInput, validFile);

    await waitFor(() => {
      expect(uploadSpy).toHaveBeenCalledWith(validFile);
    });

    await waitFor(() => {
      expect(updateAvatarSpy).toHaveBeenCalledWith(uploadedMediaUrl);
    });

    expect(await screen.findByText('Фото профиля обновлено')).toBeInTheDocument();

    const cachedUser = queryClient.getQueryData<IUserDto>(userKeys.me());
    expect(cachedUser?.avatarUrl).toBe(uploadedMediaUrl);
    expect(useProfileStore.getState().user?.avatarUrl).toBe(uploadedMediaUrl);

    expect(revokeSpy).toHaveBeenCalledWith(mockCreatedBlobUrl);
    expect(container.querySelector('img')).toHaveAttribute('src', uploadedMediaUrl);
  });

  it('при сбое загрузки медиа показывает ошибку и откатывает предпросмотр', async () => {
    vi.spyOn(services.mediaService, 'upload').mockRejectedValue(new Error('Network error'));
    const updateAvatarSpy = vi.spyOn(services.userService, 'updateAvatar');

    const { container, queryClient } = renderForm();

    const fileInput = screen.getByTestId('avatar-file-input');
    const validFile = new File(['avatar binary'], 'avatar.jpg', { type: 'image/jpeg' });

    await userEvent.upload(fileInput, validFile);

    expect(await screen.findByText('Не удалось загрузить фото профиля')).toBeInTheDocument();
    expect(updateAvatarSpy).not.toHaveBeenCalled();

    // Кеш не изменился
    const cachedUser = queryClient.getQueryData<IUserDto>(userKeys.me());
    expect(cachedUser?.avatarUrl).toBe(INITIAL_USER.avatarUrl);

    // Аватар вернулся к исходному
    const avatarImg = container.querySelector('img');
    expect(avatarImg).toHaveAttribute('src', INITIAL_USER.avatarUrl);
  });

  it('при сбое сохранения аватара в профиль показывает ошибку и откатывает предпросмотр', async () => {
    const uploadedMediaUrl = '/api/v2/media/mock-new-avatar';
    vi.spyOn(services.mediaService, 'upload').mockResolvedValue({
      url: uploadedMediaUrl,
    });
    vi.spyOn(services.userService, 'updateAvatar').mockRejectedValue(new Error('Update failed'));

    const { container, queryClient } = renderForm();

    const fileInput = screen.getByTestId('avatar-file-input');
    const validFile = new File(['avatar binary'], 'avatar.jpg', { type: 'image/jpeg' });

    await userEvent.upload(fileInput, validFile);

    expect(await screen.findByText('Не удалось загрузить фото профиля')).toBeInTheDocument();

    // Кеш не изменился
    const cachedUser = queryClient.getQueryData<IUserDto>(userKeys.me());
    expect(cachedUser?.avatarUrl).toBe(INITIAL_USER.avatarUrl);

    // Аватар вернулся к исходному
    const avatarImg = container.querySelector('img');
    expect(avatarImg).toHaveAttribute('src', INITIAL_USER.avatarUrl);
  });
});

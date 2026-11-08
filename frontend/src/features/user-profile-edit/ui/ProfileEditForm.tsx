import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Avatar, Button, Icon, Input, Spinner, Textarea, showToast } from '@/shared/ui';
import {
  checkUsernameQuery,
  MIN_USERNAME_LENGTH,
  USERNAME_PATTERN,
  useProfileStore,
  userKeys,
  validateAvatarFile,
} from '@/entities/user';
import { describeApiError } from '@/shared/api';
import { AvatarCropModal } from '@/shared/ui/AvatarCropModal/AvatarCropModal';
import { services } from '@/services/serviceContainer';
import type { IUserDto } from '@/types';
import { createProfileFormSchema, type TProfileForm } from '../model/profileSchema';

interface Props {
  user: Partial<IUserDto>;
  onBack: () => void;
  onUserChange?: (user: IUserDto) => void;
}

function getUsernameErrorMessage(err: unknown, t: TFunction): string {
  const apiErr = err as { code?: string; headers?: Headers };
  if (apiErr?.code === 'username_taken') {
    return t('errors.usernameTaken', 'Это имя уже занято');
  }
  if (apiErr?.code === 'username_change_cooldown') {
    const retryAfter = apiErr.headers?.get?.('Retry-After') ?? apiErr.headers?.get?.('retry-after');
    const seconds = retryAfter ? parseInt(retryAfter, 10) : NaN;
    if (!Number.isNaN(seconds) && seconds > 0) {
      const hours = Math.ceil(seconds / 3600);
      return `${describeApiError(apiErr, t)} (${t('errors.cooldownHours', 'Осталось подождать {{hours}} ч.', { hours })})`;
    }
    return describeApiError(apiErr, t);
  }
  return describeApiError(apiErr, t, t('profileSaveError', 'Не удалось сохранить профиль'));
}

export function ProfileEditForm({ user, onBack, onUserChange }: Props) {
  const { t } = useTranslation();
  /* Сообщения схемы — на языке интерфейса: сменился язык — новая схема. */
  const schema = useMemo(() => createProfileFormSchema(t), [t]);
  const queryClient = useQueryClient();
  const setUser = useProfileStore((state) => state.setUser);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(user.avatarUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  useEffect(() => {
    setAvatarUrl(user.avatarUrl);
  }, [user.avatarUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<TProfileForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      username: user.username || '',
      bio: user.bio || '',
    },
    mode: 'onTouched',
  });

  const bio = watch('bio') ?? '';
  const currentUsername = (user.username || '').toLowerCase();
  const username = watch('username') ?? '';
  const [debouncedUsername, setDebouncedUsername] = useState(user.username || '');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUsername(username);
    }, 400);
    return () => clearTimeout(timer);
  }, [username]);

  const isCurrentUsername = username.trim().toLowerCase() === currentUsername;
  const isDebouncedCurrent = debouncedUsername.trim().toLowerCase() === currentUsername;

  const isFormatValid = USERNAME_PATTERN.test(username.trim());
  const isMinLength = username.trim().length >= MIN_USERNAME_LENGTH;

  const shouldCheck = !isCurrentUsername && !isDebouncedCurrent && isFormatValid && isMinLength;

  const { data: usernameCheck, isFetching: isCheckingUsername } = useQuery({
    ...checkUsernameQuery(debouncedUsername),
    enabled: shouldCheck,
  });

  const isTyping = username !== debouncedUsername && isMinLength;
  const isChecking = Boolean((isTyping || isCheckingUsername) && shouldCheck);
  const isTaken = Boolean(shouldCheck && !isTyping && usernameCheck && !usernameCheck.available);
  const isAvailable = Boolean(shouldCheck && !isTyping && usernameCheck && usernameCheck.available);

  let usernameHelperHint: string | undefined;
  let usernameHelperError: string | undefined = errors.username?.message;
  let usernameAddon: ReactNode = null;

  if (usernameHelperError) {
    usernameAddon = <Icon className="text-danger" name="warning" size="sm" />;
  } else if (isFormatValid && isMinLength && !isCurrentUsername) {
    if (isChecking) {
      usernameHelperHint = t('register.usernameChecking', 'Проверка доступности имени...');
      usernameAddon = <Spinner size="sm" />;
    } else if (isTaken) {
      usernameHelperError = t('register.usernameTaken', 'Это имя пользователя занято');
      usernameAddon = <Icon className="text-danger" name="warning" size="sm" />;
    } else if (isAvailable) {
      usernameHelperHint = t('register.usernameAvailable', 'Имя пользователя свободно');
      usernameAddon = <Icon className="text-brand" name="check" size="sm" />;
    }
  }

  async function submit(values: TProfileForm) {
    const trimmedUsername = values.username.trim();
    const isUsernameChanged = trimmedUsername.toLowerCase() !== currentUsername;
    const isProfileChanged =
      values.firstName.trim() !== (user.firstName || '') ||
      values.lastName.trim() !== (user.lastName || '') ||
      values.bio.trim() !== (user.bio || '');

    if (!isUsernameChanged && !isProfileChanged) {
      onBack();
      return;
    }

    let updatedUser: IUserDto | undefined;

    if (isUsernameChanged) {
      try {
        updatedUser = await services.userService.updateUsername(trimmedUsername);
        queryClient.setQueryData(userKeys.me(), updatedUser);
        setUser(updatedUser);
      } catch (err) {
        setError('username', {
          message: getUsernameErrorMessage(err, t),
        });
        return;
      }
    }

    if (isProfileChanged) {
      try {
        updatedUser = await services.userService.updateMe({
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          bio: values.bio.trim(),
        });
        queryClient.setQueryData(userKeys.me(), updatedUser);
        setUser(updatedUser);
      } catch (err) {
        showToast(
          'error',
          describeApiError(
            err as { code?: string },
            t,
            t('profileSaveError', 'Не удалось сохранить профиль')
          )
        );
        return;
      }
    }

    if (updatedUser) {
      onUserChange?.(updatedUser);
    }
    showToast('success', t('toast.profileUpdated', 'Профиль обновлён'));
    onBack();
  }

  function handleAvatarSelect(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';

    if (!picked) return;

    // Crop the original so zooming does not magnify an already reduced image.
    // Large photos become at most 640×640 on export; GIF keeps the existing input limit.
    const validation = validateAvatarFile(picked);
    if (
      !validation.valid &&
      (validation.errorCode === 'invalidType' || picked.type === 'image/gif')
    ) {
      const errorMessage =
        validation.errorCode === 'tooLarge'
          ? t('settings.profile.avatarTooLarge', 'Файл слишком большой. Максимальный размер 5 МБ')
          : t(
              'settings.profile.avatarInvalidType',
              'Поддерживаются только изображения (JPEG, PNG, WebP, GIF)'
            );
      showToast('error', errorMessage);
      return;
    }

    setCropFile(picked);
  }

  async function saveAvatar(file: File) {
    setCropFile(null);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setIsUploadingAvatar(true);

    try {
      const uploadResult = await services.mediaService.upload(file);
      if (!uploadResult?.url) {
        throw new Error('Upload returned no URL');
      }

      const updated = await services.userService.updateAvatar(uploadResult.url);
      setAvatarUrl(updated.avatarUrl);
      queryClient.setQueryData(userKeys.me(), updated);
      setUser(updated);
      onUserChange?.(updated);
      showToast('success', t('settings.profile.avatarUpdated', 'Фото профиля обновлено'));
    } catch (_) {
      showToast(
        'error',
        t('settings.profile.avatarUploadFailed', 'Не удалось загрузить фото профиля')
      );
    } finally {
      if (objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
      setPreviewUrl(null);
      setIsUploadingAvatar(false);
    }
  }

  /* Заголовок и «назад» — в шапке раздела настроек (#828); здесь только
     карточка формы, как в макете. */
  return (
    <section className="flex flex-col gap-4 rounded-dialog bg-card p-5">
      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onComplete={saveAvatar}
        />
      )}
      <div className="flex items-center gap-4">
        <Avatar
          id={user.id}
          name={user.firstName || user.username}
          size="card"
          src={previewUrl ?? avatarUrl ?? user.avatarUrl}
        />
        <input
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          data-testid="avatar-file-input"
          onChange={handleAvatarSelect}
          ref={fileInputRef}
          type="file"
        />
        <Button
          disabled={Boolean(cropFile)}
          loading={isUploadingAvatar}
          onClick={() => fileInputRef.current?.click()}
          type="button"
          variant="secondary"
        >
          {t('settings.profile.changePhoto', 'Изменить фото')}
        </Button>
      </div>

      <form className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <Input
          error={errors.firstName?.message}
          label={t('settings.profile.firstName', 'Имя')}
          {...register('firstName')}
        />
        <Input
          error={errors.lastName?.message}
          label={t('settings.profile.lastName', 'Фамилия')}
          {...register('lastName')}
        />
        <Input
          addon={usernameAddon}
          autoCapitalize="none"
          autoComplete="username"
          autoCorrect="off"
          error={usernameHelperError}
          hint={
            usernameHelperHint ??
            t('register.usernameRules', 'Латинские буквы, цифры и _, от 3 до 32 символов')
          }
          inputClassName="pl-8.5"
          label={t('username', 'Имя пользователя')}
          maxLength={32}
          placeholder="username"
          prefix="@"
          {...register('username')}
        />
        <Textarea
          error={errors.bio?.message}
          hint={`${bio.length} / 160`}
          label={t('settings.profile.bio', 'О себе')}
          rows={3}
          {...register('bio')}
        />

        <div className="flex justify-end gap-2">
          <Button onClick={onBack} type="button" variant="ghost">
            {t('cancel', 'Отмена')}
          </Button>
          <Button disabled={!isDirty} loading={isSubmitting} type="submit">
            {t('save', 'Сохранить')}
          </Button>
        </div>
      </form>
    </section>
  );
}

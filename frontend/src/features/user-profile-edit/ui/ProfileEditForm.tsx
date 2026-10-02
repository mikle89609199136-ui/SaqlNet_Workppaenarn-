import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Input, Textarea, showToast } from '@/shared/ui';
import { useProfileStore, userKeys, validateAvatarFile } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import type { IUserDto } from '@/types';
import { profileFormSchema, type TProfileForm } from '../model/profileSchema';

interface Props {
  user: Partial<IUserDto>;
  onBack: () => void;
  onUserChange?: (user: IUserDto) => void;
}

export function ProfileEditForm({ user, onBack, onUserChange }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setUser = useProfileStore((state) => state.setUser);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(user.avatarUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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
    formState: { errors, isSubmitting, isDirty },
  } = useForm<TProfileForm>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      bio: user.bio || '',
    },
    mode: 'onTouched',
  });

  const bio = watch('bio') ?? '';

  async function submit(values: TProfileForm) {
    try {
      const updated = await services.userService.updateMe(values);
      queryClient.setQueryData(userKeys.me(), updated);
      setUser(updated);
      onUserChange?.(updated);
      showToast('success', t('toast.profileUpdated', 'Профиль обновлён'));
      onBack();
    } catch (_) {
      showToast('error', t('profileSaveError', 'Не удалось сохранить профиль'));
    }
  }

  async function handleAvatarSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    const validation = validateAvatarFile(file);
    if (!validation.valid) {
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

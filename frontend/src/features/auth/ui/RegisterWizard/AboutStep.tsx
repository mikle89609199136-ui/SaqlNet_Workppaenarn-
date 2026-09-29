import type { ChangeEvent, RefObject } from 'react';
import type { UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Icon, Input } from '@/shared/ui';
import type { TRegisterForm } from '../../model/registerSchema';

interface Props {
  avatar: string;
  avatarInputRef: RefObject<HTMLInputElement | null>;
  errorOf: (field: keyof TRegisterForm) => string | undefined;
  onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
  register: UseFormRegister<TRegisterForm>;
}

export function AboutStep({ avatar, avatarInputRef, errorOf, onAvatarChange, register }: Props) {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex flex-col items-center gap-2">
        <button
          className="relative size-24 cursor-pointer overflow-hidden rounded-full border-2 border-dashed border-divider transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-brand data-[filled=true]:border-solid data-[filled=true]:border-brand-fill"
          data-filled={Boolean(avatar)}
          onClick={() => avatarInputRef.current?.click()}
          type="button"
        >
          {avatar ? (
            <img alt="" className="h-full w-full object-cover" src={avatar} />
          ) : (
            <Icon className="mx-auto size-7 stroke-[1.8px] text-ink-3" name="camera" />
          )}
        </button>
        <span className="text-caption text-ink-3">
          {t('tapAddPhoto', 'Нажмите, чтобы добавить фото')}
        </span>
        <input
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={onAvatarChange}
          ref={avatarInputRef}
          type="file"
        />
      </div>

      <Input
        autoComplete="given-name"
        error={errorOf('firstName')}
        label={t('firstName', 'Имя')}
        maxLength={64}
        placeholder={t('firstNamePlaceholder', 'Ваше имя')}
        {...register('firstName')}
      />

      <Input
        autoComplete="family-name"
        error={errorOf('lastName')}
        optional
        label={t('lastName', 'Фамилия')}
        maxLength={64}
        placeholder={t('lastNamePlaceholder', 'Ваша фамилия')}
        {...register('lastName')}
      />
    </>
  );
}

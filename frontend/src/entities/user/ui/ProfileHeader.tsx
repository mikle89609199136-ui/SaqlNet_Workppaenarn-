import { Avatar, Icon } from '@/shared/ui';
import type { TIconTypes } from '@/types';
import type { IUserDto } from '../model/types';
import { cn } from '@/shared/lib';
import { useTranslation } from 'react-i18next';

interface Props {
  profileUser: IUserDto;
  isMyProfile: boolean;
  isPeerOnline: boolean;
  profileSubtitle: string | null;
  hasChat: boolean;
  /** Нет — кнопок звонка нет (звонки выключены, #776). */
  onCall?: (kind: 'audio' | 'video') => void;
  onStartEdit: () => void;
}

interface ITile {
  key: string;
  icon: TIconTypes;
  label: string;
  /** Полное имя для диктора, когда подпись на плитке короткая. */
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Шапка профиля — по макету (#822): без фона и рамок, аватар 96, имя
 * 20px, под ним «@ник · статус» (в сети — акцентом), ниже плитки действий
 * на приподнятой поверхности.
 *
 * Плиток «Поиск» и «Звук» из макета пока нет — их функции делаются в
 * #841 и #559; плитки появятся вместе с ними.
 */
export function ProfileHeader({
  profileUser,
  isMyProfile,
  isPeerOnline,
  profileSubtitle,
  hasChat,
  onCall,
  onStartEdit,
}: Props) {
  const { t } = useTranslation();
  const name = profileUser.firstName || profileUser.username || t('user', 'Пользователь');

  const tiles: ITile[] = isMyProfile
    ? [
        {
          key: 'edit',
          icon: 'edit',
          label: t('editProfile', 'Редактировать'),
          onClick: onStartEdit,
        },
      ]
    : !onCall
      ? []
      : [
          {
            key: 'call',
            icon: 'phone',
            label: t('profile.call', 'Звонок'),
            ariaLabel: t('audioCall', 'Аудиозвонок'),
            onClick: () => onCall('audio'),
            disabled: !hasChat,
          },
          {
            key: 'video',
            icon: 'video',
            label: t('profile.video', 'Видео'),
            ariaLabel: t('profile.videoCall', 'Видеозвонок'),
            onClick: () => onCall('video'),
            disabled: !hasChat,
          },
        ];

  return (
    <>
      <div className="flex flex-col items-center gap-1.5 px-5 pb-5 text-center">
        <Avatar
          className="mb-2"
          id={profileUser.id}
          name={name}
          online={isPeerOnline}
          size="2xl"
          src={profileUser.avatarUrl}
        />
        <h2 className="text-section font-semibold text-ink">{name}</h2>
        <p className="text-ui text-ink-2">
          {profileUser.username && `@${profileUser.username}`}
          {profileUser.username && profileSubtitle && ' · '}
          {profileSubtitle && (
            <span className={cn(isPeerOnline ? 'text-brand' : 'text-ink-3')}>
              {profileSubtitle}
            </span>
          )}
        </p>
      </div>

      {/* Плиток нет (чужой профиль, звонки выключены) — ряда тоже нет. */}
      {tiles.length > 0 && (
        <div
          className="grid gap-2 px-4 pb-5"
          style={{ gridTemplateColumns: `repeat(${Math.max(tiles.length, 1)}, minmax(0, 1fr))` }}
        >
          {tiles.map((tile) => (
            <button
              aria-label={tile.ariaLabel}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1.5 rounded-button bg-sheet-2 pt-3 pb-2.5 text-meta text-brand',
                'transition-colors duration-fast hover:layer-hover active:layer-press',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2'
              )}
              disabled={tile.disabled}
              key={tile.key}
              onClick={tile.onClick}
              type="button"
            >
              <Icon className="size-5" name={tile.icon} />
              <span className="text-ink-2">{tile.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

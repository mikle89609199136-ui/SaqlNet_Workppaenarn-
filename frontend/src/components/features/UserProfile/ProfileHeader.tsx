import { Avatar, Button, Icon } from '@/components/ui';
import type { TCallKind, IUserDto } from '@/types';
import { cn } from '@/utils';
import { useTranslation } from 'react-i18next';

interface Props {
  profileUser: IUserDto;
  isMyProfile: boolean;
  isPeerOnline: boolean;
  profileSubtitle: string | null;
  hasChat: boolean;
  onClose: () => void;
  onCall: (kind: TCallKind) => void;
  onStartEdit: () => void;
}

export function ProfileHeader({
  profileUser,
  isMyProfile,
  isPeerOnline,
  profileSubtitle,
  hasChat,
  onClose,
  onCall,
  onStartEdit,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-full flex items-center justify-between pb-3 border-b border-line">
        <h3 className="text-title font-semibold text-ink">{t('profile', 'Профиль')}</h3>
        <Button
          aria-label={t('close', 'Закрыть')}
          iconOnly
          onClick={onClose}
          size="sm"
          variant="ghost"
        >
          <Icon name="cross" />
        </Button>
      </div>

      <div className="mt-4">
        <Avatar
          id={profileUser.id}
          name={profileUser.username}
          online={isPeerOnline}
          size="xl"
          src={profileUser.avatarUrl}
        />
      </div>

      <h2 className="mt-3 text-title font-bold text-ink">
        {profileUser.firstName || profileUser.username || t('user', 'Пользователь')}
      </h2>

      <p className="text-caption text-ink-2">@{profileUser.username}</p>

      {profileSubtitle && (
        <p className={cn('mt-1 text-caption font-medium', isPeerOnline ? 'text-brand' : 'text-ink-2')}>
          {profileSubtitle}
        </p>
      )}

      <div className="mt-4 flex items-center justify-center gap-3 w-full">
        {isMyProfile ? (
          <Button
            onClick={onStartEdit}
            size="md"
            variant="secondary"
          >
            <Icon name="edit" />
            {t('editProfile', 'Редактировать')}
          </Button>
        ) : (
          <>
            <Button
              disabled={!hasChat}
              onClick={() => onCall('audio')}
              size="md"
              title={t('audioCall', 'Аудиозвонок')}
              variant="secondary"
            >
              <Icon name="phone" />
              {t('audioCall', 'Аудиозвонок')}
            </Button>
            <Button
              disabled={!hasChat}
              onClick={() => onCall('video')}
              size="md"
              title={t('videoCall', 'Видеозвонок')}
              variant="secondary"
            >
              <Icon name="video" />
              {t('videoCall', 'Видеозвонок')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

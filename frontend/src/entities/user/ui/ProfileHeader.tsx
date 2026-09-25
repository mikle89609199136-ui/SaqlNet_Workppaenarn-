import { Avatar, Button, Icon } from '@/shared/ui';
import type { TCallKind } from '@/shared/types';
import type { IUserDto } from '../model/types';
import { cn } from '@/shared/lib';
import { useTranslation } from 'react-i18next';

interface Props {
  profileUser: IUserDto;
  isMyProfile: boolean;
  isPeerOnline: boolean;
  profileSubtitle: string | null;
  hasChat: boolean;
  isBlocked?: boolean;
  onClose: () => void;
  onCall: (kind: TCallKind) => void;
  onStartEdit: () => void;
  onBlock?: () => void;
  onUnblock?: () => void;
}

export function ProfileHeader({
  profileUser,
  isMyProfile,
  isPeerOnline,
  profileSubtitle,
  hasChat,
  isBlocked = false,
  onClose,
  onCall,
  onStartEdit,
  onBlock,
  onUnblock,
}: Props) {
  const { t } = useTranslation();
  const effectiveOnline = isBlocked ? false : isPeerOnline;
  const effectiveSubtitle = isBlocked
    ? t('settings.privacy.userBlocked', 'Заблокирован')
    : profileSubtitle;

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
          online={effectiveOnline}
          size="xl"
          src={profileUser.avatarUrl}
        />
      </div>

      <h2 className="mt-3 text-title font-bold text-ink">
        {profileUser.firstName || profileUser.username || t('user', 'Пользователь')}
      </h2>

      <p className="text-caption text-ink-2">@{profileUser.username}</p>

      {effectiveSubtitle && (
        <p
          className={cn(
            'mt-1 text-caption font-medium',
            isBlocked ? 'text-danger' : effectiveOnline ? 'text-brand' : 'text-ink-2'
          )}
        >
          {effectiveSubtitle}
        </p>
      )}

      <div className="mt-4 flex items-center justify-center gap-3 w-full">
        {isMyProfile ? (
          <Button onClick={onStartEdit} size="md" variant="secondary">
            <Icon name="edit" />
            {t('editProfile', 'Редактировать')}
          </Button>
        ) : (
          <div className="flex flex-col items-center gap-2 w-full">
            <div className="flex items-center justify-center gap-3 w-full">
              <Button
                disabled={!hasChat || isBlocked}
                onClick={() => onCall('audio')}
                size="md"
                title={t('audioCall', 'Аудиозвонок')}
                variant="secondary"
              >
                <Icon name="phone" />
                {t('audioCall', 'Аудиозвонок')}
              </Button>
              <Button
                disabled={!hasChat || isBlocked}
                onClick={() => onCall('video')}
                size="md"
                title={t('videoCall', 'Видеозвонок')}
                variant="secondary"
              >
                <Icon name="video" />
                {t('videoCall', 'Видеозвонок')}
              </Button>
            </div>

            {isBlocked ? (
              onUnblock && (
                <Button className="w-full" onClick={onUnblock} size="md" variant="secondary">
                  {t('settings.privacy.unblock', 'Разблокировать')}
                </Button>
              )
            ) : (
              onBlock && (
                <Button
                  className="w-full text-danger hover:bg-danger/10 hover:text-danger"
                  onClick={onBlock}
                  size="md"
                  variant="ghost"
                >
                  <Icon name="cross" />
                  {t('settings.privacy.block', 'Заблокировать')}
                </Button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useCall, useProfileEdit, useSafetyCode } from '@/hooks';
import type { IProfileState } from '@/pages';
import { userProfileQuery } from '@/queries/users/userProfileQuery';
import { useProfileStore } from '@/store';
import { useQuery } from '@tanstack/react-query';
import type { TCallKind, TIconTypes } from '@/types';
import { getChatSubtitle } from '@/utils';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Icon } from '@/components/ui';

interface Props {
  profileState: IProfileState;
  onClose: () => void;
}

interface IActionButton {
  handleClick: () => void;
  title: string;
  disabled: boolean;
  name: TIconTypes;
}

interface IField {
  firstName: string;
  bio: string;
}

const fields: (keyof IField)[] = ['firstName', 'bio'];

export const UserProfilePanel = memo(({ profileState, onClose }: Props) => {
  const { t } = useTranslation();
  const { initiateCall } = useCall();
  const currentUser = useProfileStore((state) => state.user);

  // Профиль читается по идентификатору, а не передаётся сверху: раньше его
  // запрашивал обработчик клика по шапке, и каждое открытие панели означало
  // новый запрос (#232).
  const {
    data: profileUser,
    isLoading,
    isError,
  } = useQuery(userProfileQuery(profileState.userId));

  const {
    isSaving,
    isEditMode,
    editedProfile,
    handleSave,
    setEditMode,
    handleInputChange,
    handleToggleEditMode,
  } = useProfileEdit(profileUser);

  const { isVerifying, verifyIdentity, verified } = useSafetyCode(profileUser?.id);

  const sharedMedia = useMemo(() => {
    return (profileState.messages || []).filter((message) => {
      const type = message.type;
      return Boolean(message.mediaUrl && (type === 'image' || type === 'video'));
    });
  }, [profileState.messages]);

  const profileSubtitle = useMemo(() => {
    if (!profileState.chat) return null;
    return getChatSubtitle(profileState.chat, null, t);
  }, [profileState.chat, t]);

  const isMyProfile = currentUser?.id === profileUser?.id;
  const isPeerOnline = Boolean(profileUser?.isOnline);

  const handleCall = (kind: TCallKind) => {
    if (!profileUser?.id || !profileState.chat) return;
    initiateCall(profileState.chat.id, 'private', profileUser.username, kind, profileUser.id);
  };

  const actionButtons: IActionButton[] = [
    {
      name: 'phone',
      title: t('audioCall', 'Аудиозвонок'),
      disabled: !profileState.chat,
      handleClick: () => handleCall('audio'),
    },
    {
      name: 'video',
      title: t('videoCall', 'Видеозвонок'),
      disabled: !profileState.chat,
      handleClick: () => handleCall('video'),
    },
    {
      name: 'edit',
      title: t('editProfile', 'Редактировать'),
      disabled: false,
      handleClick: handleToggleEditMode,
    },
  ];

  if (isLoading) {
    return (
      <aside aria-busy="true" className="user-profile-panel" role="complementary">
        <header className="user-profile-header">
          <div className="user-profile-top-actions">
            <button
              aria-label={t('close', 'Закрыть')}
              className="user-profile-icon-btn"
              onClick={onClose}
              type="button"
            >
              <Icon name="cross" />
            </button>
          </div>
        </header>
        <div className="user-profile-loading">{t('loading', 'Загрузка...')}</div>
      </aside>
    );
  }

  if (isError || !profileUser) {
    return (
      <aside className="user-profile-panel" role="complementary">
        <header className="user-profile-header">
          <div className="user-profile-top-actions">
            <button
              aria-label={t('close', 'Закрыть')}
              className="user-profile-icon-btn"
              onClick={onClose}
              type="button"
            >
              <Icon name="cross" />
            </button>
          </div>
        </header>
        <div className="user-profile-error">
          {t('profileLoadError', 'Не удалось загрузить профиль')}
        </div>
      </aside>
    );
  }

  return (
    <section className="user-profile-panel">
      <header className="user-profile-header">
        <div className="user-profile-top-actions">
          <button
            aria-label={t('close', 'Закрыть')}
            className="user-profile-icon-btn"
            onClick={onClose}
            type="button"
          >
            <Icon name="cross" />
          </button>
        </div>

        <div className="user-profile-avatar-wrap">
          <Avatar
            id={profileUser.id}
            name={profileUser.username}
            online={isPeerOnline}
            size="xl"
            src={profileUser.avatarUrl}
          />
        </div>

        <h2 className="user-profile-name">
          {profileUser.firstName || profileUser.username || t('user', 'Пользователь')}
        </h2>
        {profileSubtitle && <p className="user-profile-status">{profileSubtitle}</p>}

        <div className="user-profile-actions">
          {actionButtons
            .filter((item) => (isMyProfile ? item.name === 'edit' : item.name !== 'edit'))
            .map((btn) => (
              <button
                className="user-profile-action-btn"
                disabled={btn.disabled}
                key={btn.name}
                onClick={btn.handleClick}
                title={btn.title}
                type="button"
              >
                <Icon name={btn.name} />
              </button>
            ))}
        </div>
      </header>

      <div className="user-profile-details">
        {fields.map((field) => (
          <div className="user-profile-field" key={field}>
            <span className="user-profile-label">
              {field === 'firstName' ? t('name', 'Имя') : t('bio', 'О себе')}
            </span>
            {isEditMode ? (
              <input
                className="user-profile-input"
                name={field}
                onChange={handleInputChange}
                value={editedProfile[field] || ''}
              />
            ) : (
              <span className="user-profile-value">
                {profileUser[field] || t('notSpecified', 'Не указано')}
              </span>
            )}
          </div>
        ))}

        <div className="user-profile-field">
          <span className="user-profile-label">{t('username', 'Имя пользователя')}</span>
          <span className="user-profile-value">@{profileUser.username}</span>
        </div>

        {isEditMode && (
          <div className="user-profile-edit-actions">
            <button
              className="user-profile-save-btn"
              disabled={isSaving}
              onClick={handleSave}
              type="button"
            >
              {isSaving ? t('saving', 'Сохранение...') : t('save', 'Сохранить')}
            </button>
            <button
              className="user-profile-cancel-btn"
              disabled={isSaving}
              onClick={() => setEditMode(false)}
              type="button"
            >
              {t('cancel', 'Отмена')}
            </button>
          </div>
        )}
      </div>

      {!isMyProfile && (
        <div className="user-profile-security">
          <div className="user-profile-security-header">
            <div>
              <h3>{t('securityCode', 'Код безопасности')}</h3>
              <p>
                {t(
                  'securityCodeDesc',
                  'Сверьте эти числа с собеседником при встрече или по другому каналу связи'
                )}
              </p>
            </div>
            {verified ? (
              <span className="user-profile-verified-badge">{t('verified', 'Подтверждён')}</span>
            ) : null}
          </div>

          <div className="user-profile-security-code" role="group">
            <p>
              {t(
                'securityCodeInstructions',
                'Если числа совпадают у обоих, переписку никто не перехватывает.'
              )}
            </p>
          </div>

          {!verified ? (
            <button
              className="user-profile-verify-btn"
              disabled={isVerifying}
              onClick={() => void verifyIdentity()}
              type="button"
            >
              {isVerifying
                ? t('confirming', 'Подтверждаем...')
                : t('confirmMatch', 'Код совпадает')}
            </button>
          ) : null}
        </div>
      )}

      {profileState.chat && (
        <div className="user-profile-shared-media">
          <h3>{t('sharedMedia', 'Общие медиафайлы')}</h3>
          {sharedMedia.length > 0 ? (
            <div className="user-profile-media-grid">
              {sharedMedia.map((message) => {
                const isVideo = message.type === 'video';
                const id = message.id;
                const mediaUrl = message.mediaUrl;
                return (
                  <a
                    className="user-profile-media-item"
                    href={mediaUrl}
                    key={id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {isVideo ? (
                      <video muted preload="metadata" src={mediaUrl} />
                    ) : (
                      <img alt="" loading="lazy" src={mediaUrl} />
                    )}
                    {isVideo && <span aria-hidden="true">▶</span>}
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="user-profile-empty-media">
              {t('profileMediaEmpty', 'Медиафайлы отсутствуют')}
            </div>
          )}
        </div>
      )}
    </section>
  );
});

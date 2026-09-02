import { useCall, useProfileEdit } from '@/hooks';
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
  const { data: profileUser, isLoading, isError } = useQuery(userProfileQuery(profileState.userId));

  const displayName =
    [profileUser?.firstName, profileUser?.lastName].filter(Boolean).join(' ') ||
    profileUser?.username ||
    profileState.chat?.title ||
    t('user', 'Пользователь');

  /* Имена берутся из `useProfileEdit` как есть. Разметка одно время
     ждала другой набор — `isEditMode`, `editedProfile`, `handleSave` и
     прочее, — которого хук никогда не отдавал: панель не собиралась по
     типам и падала при открытии. */
  const { isSaving, isEditing, setIsEditing, editDraft, setEditDraft, startEdit, saveProfileEdit } =
    useProfileEdit(profileUser, displayName);

  /* Хук отдаёт сам код строкой. Разметка ниже одно время ждала от него
     объект с подтверждением личности — `verified`, `verifyIdentity`, —
     но такого ни в хуке, ни в сервисах нет: деструктуризация `null`
     роняла панель, стоило её открыть. Подтверждение личности — отдельная
     работа, а до неё код показывается и копируется, как и раньше. */
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
      handleClick: () => (isEditing ? setIsEditing(false) : startEdit()),
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
            {isEditing ? (
              <input
                className="user-profile-input"
                name={field}
                onChange={(event) =>
                  setEditDraft((draft) => ({ ...draft, [field]: event.target.value }))
                }
                value={editDraft[field] || ''}
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

        {isEditing && (
          <div className="user-profile-edit-actions">
            <button
              className="user-profile-save-btn"
              disabled={isSaving}
              onClick={saveProfileEdit}
              type="button"
            >
              {isSaving ? t('saving', 'Сохранение...') : t('save', 'Сохранить')}
            </button>
            <button
              className="user-profile-cancel-btn"
              disabled={isSaving}
              onClick={() => setIsEditing(false)}
              type="button"
            >
              {t('cancel', 'Отмена')}
            </button>
          </div>
        )}
      </div>

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

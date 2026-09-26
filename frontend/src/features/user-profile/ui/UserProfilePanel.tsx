import { Spinner } from '@/shared/ui';
import { useCall } from '@/features/call';
import { useProfileEdit } from '../model/useProfileEdit';
import {
  type IProfileState,
  userProfileQuery,
  userStatusQuery,
  ProfileHeader,
  ProfilePanelFallback,
  useProfileStore,
} from '@/entities/user';
import { useQuery } from '@tanstack/react-query';
import { formatLastSeen, formatLastSeenApprox, getChatSubtitle, useNow } from '@/shared/lib';
import { memo, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileDetails } from './ProfileDetails';
import { isDisplayableMedia, ProfileSharedMedia } from './ProfileSharedMedia';

/** Чей профиль открыт — для действий, которые приходят сверху. */
export interface IProfileActionsTarget {
  id: string;
  name: string;
}

interface Props {
  profileState: IProfileState;
  onClose: () => void;
  /**
   * Действия с чужим профилем — сейчас блокировка (#727). Приходят от
   * страницы: блокировка — отдельная фича, и панель о ней не знает.
   */
  renderActions?: (target: IProfileActionsTarget) => ReactNode;
}

export const UserProfilePanel = memo(({ profileState, onClose, renderActions }: Props) => {
  const { t } = useTranslation();
  const now = useNow();
  const { initiateCall } = useCall();
  const currentUser = useProfileStore((state) => state.user);
  const targetUserId = profileState.userId || '';

  /* Чат и его лента — только если это личный чат именно с этим человеком.
     Профиль открывается и по имени автора пересланного сообщения (#785):
     тогда открытый чат чужой, и его статус, общие медиа и звонок
     относились бы к другому собеседнику. */
  const chat =
    profileState.chat?.type === 'private' && profileState.chat.peerId === profileState.userId
      ? profileState.chat
      : null;
  const chatMessages = chat ? profileState.messages : undefined;
  const {
    data: profileUser,
    isLoading,
    isError,
  } = useQuery(userProfileQuery(targetUserId));
  const isMyProfile = Boolean(
    currentUser?.id && (currentUser.id === targetUserId || currentUser.id === profileUser?.id)
  );
  const { data: statusData } = useQuery(userStatusQuery(targetUserId, { enabled: !isMyProfile }));

  const displayName =
    [profileUser?.firstName, profileUser?.lastName].filter(Boolean).join(' ') ||
    profileUser?.username ||
    chat?.title ||
    t('user', 'Пользователь');

  const {
    isEditing,
    setIsEditing,
    editDraft,
    setEditDraft,
    editError,
    isSaving,
    startEdit,
    saveProfileEdit,
  } = useProfileEdit(profileUser, displayName);

  const sharedMedia = useMemo(
    () => (chatMessages || []).filter(isDisplayableMedia),
    [chatMessages]
  );

  const isPeerOnline =
    !isMyProfile && (statusData ? statusData.isOnline : Boolean(profileUser?.isOnline));

  const profileSubtitle = useMemo(() => {
    if (isMyProfile) return null;
    if (statusData) {
      if (statusData.isOnline) return t('online', 'онлайн');
      if (statusData.lastSeen) return formatLastSeen(statusData.lastSeen, t, { now });
      return formatLastSeenApprox(statusData.lastSeenApprox ?? 'long_ago', t);
    }
    return chat ? getChatSubtitle(chat, null, t, now) : null;
  }, [isMyProfile, statusData, chat, t, now]);

  if (isLoading) {
    return (
      <ProfilePanelFallback ariaBusy onClose={onClose}>
        <div className="flex flex-col items-center gap-2">
          <Spinner size="md" />
          <span>{t('loading', 'Загрузка...')}</span>
        </div>
      </ProfilePanelFallback>
    );
  }

  if (isError || !profileUser) {
    return (
      <ProfilePanelFallback onClose={onClose}>
        <span className="text-danger">{t('profileLoadError', 'Не удалось загрузить профиль')}</span>
      </ProfilePanelFallback>
    );
  }

  return (
    <aside className="h-full flex flex-col bg-sheet overflow-hidden" role="complementary">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <ProfileHeader
          /* Звонить есть куда — общий личный чат — и можно: блокировка в
             любую сторону звонки запрещает, сервер их отклонит (#760). */
          hasChat={Boolean(chat) && !chat?.isBlockedByPeer && !chat?.isPeerBlocked}
          isMyProfile={isMyProfile}
          isPeerOnline={isPeerOnline}
          onCall={(kind) =>
            chat && initiateCall(chat.id, 'private', profileUser.username, kind, profileUser.id)
          }
          onClose={onClose}
          onStartEdit={startEdit}
          profileSubtitle={profileSubtitle}
          profileUser={profileUser}
        />

        <ProfileDetails
          editDraft={editDraft}
          editError={editError}
          isEditing={isEditing}
          isSaving={isSaving}
          onCancelEdit={() => setIsEditing(false)}
          onDraftChange={setEditDraft}
          onSave={saveProfileEdit}
          profileUser={profileUser}
        />

        {/* Блокировка — из профиля человека, как в Telegram (#727). */}
        {!isMyProfile &&
          profileUser.id &&
          renderActions?.({ id: profileUser.id, name: displayName })}

        {chat && <ProfileSharedMedia sharedMedia={sharedMedia} />}
      </div>
    </aside>
  );
});

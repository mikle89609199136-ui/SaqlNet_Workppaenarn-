import { Spinner } from '@/shared/ui';
import { useCall } from '@/features/call';
import { useProfileEdit } from '../model/useProfileEdit';
import {
  type IProfileState,
  userProfileQuery,
  ProfileHeader,
  ProfilePanelFallback,
  useProfileStore,
} from '@/entities/user';
import { useQuery } from '@tanstack/react-query';
import { getChatSubtitle, useNow } from '@/shared/lib';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileDetails } from './ProfileDetails';
import { isDisplayableMedia, ProfileSharedMedia } from './ProfileSharedMedia';

interface Props {
  profileState: IProfileState;
  onClose: () => void;
}

export const UserProfilePanel = memo(({ profileState, onClose }: Props) => {
  const { t } = useTranslation();
  const now = useNow();
  const { initiateCall } = useCall();
  const currentUser = useProfileStore((state) => state.user);
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
  } = useQuery(userProfileQuery(profileState.userId || ''));

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

  const isMyProfile = currentUser?.id === profileUser?.id;

  const sharedMedia = useMemo(
    () => (chatMessages || []).filter(isDisplayableMedia),
    [chatMessages]
  );

  const profileSubtitle = useMemo(
    () => (chat ? getChatSubtitle(chat, null, t, now) : null),
    [chat, t, now]
  );

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
          hasChat={Boolean(chat)}
          isMyProfile={isMyProfile}
          isPeerOnline={Boolean(profileUser.isOnline)}
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

        {chat && <ProfileSharedMedia sharedMedia={sharedMedia} />}
      </div>
    </aside>
  );
});

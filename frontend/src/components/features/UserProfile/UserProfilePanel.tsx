import { Spinner } from '@/shared/ui';
import { useCall, useProfileEdit } from '@/hooks';
import type { IProfileState } from '@/pages';
import { userProfileQuery } from '@/queries/users/userProfileQuery';
import { useProfileStore } from '@/store';
import { useQuery } from '@tanstack/react-query';
import { getChatSubtitle } from '@/shared/lib';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileDetails } from './ProfileDetails';
import { ProfileHeader } from './ProfileHeader';
import { ProfilePanelFallback } from './ProfilePanelFallback';
import { isDisplayableMedia, ProfileSharedMedia } from './ProfileSharedMedia';

interface Props {
  profileState: IProfileState;
  onClose: () => void;
}

export const UserProfilePanel = memo(({ profileState, onClose }: Props) => {
  const { t } = useTranslation();
  const { initiateCall } = useCall();
  const currentUser = useProfileStore((state) => state.user);
  const {
    data: profileUser,
    isLoading,
    isError,
  } = useQuery(userProfileQuery(profileState.userId || ''));

  const displayName =
    [profileUser?.firstName, profileUser?.lastName].filter(Boolean).join(' ') ||
    profileUser?.username ||
    profileState.chat?.title ||
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
    () => (profileState.messages || []).filter(isDisplayableMedia),
    [profileState.messages]
  );

  const profileSubtitle = useMemo(
    () => (profileState.chat ? getChatSubtitle(profileState.chat, null, t) : null),
    [profileState.chat, t]
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
          hasChat={Boolean(profileState.chat)}
          isMyProfile={isMyProfile}
          isPeerOnline={Boolean(profileUser.isOnline)}
          onCall={(kind) =>
            profileState.chat &&
            initiateCall(
              profileState.chat.id,
              'private',
              profileUser.username,
              kind,
              profileUser.id
            )
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

        {profileState.chat && <ProfileSharedMedia sharedMedia={sharedMedia} />}
      </div>
    </aside>
  );
});

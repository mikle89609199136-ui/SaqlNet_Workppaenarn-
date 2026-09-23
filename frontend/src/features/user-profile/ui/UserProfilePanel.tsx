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
import { formatLastSeen, getChatSubtitle } from '@/shared/lib';
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
  const { initiateCall } = useCall();
  const currentUser = useProfileStore((state) => state.user);
  const targetUserId = profileState.userId || '';
  const {
    data: profileUser,
    isLoading,
    isError,
  } = useQuery(userProfileQuery(targetUserId));
  const { data: statusData } = useQuery(userStatusQuery(targetUserId));

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

  const isPeerOnline =
    !isMyProfile && (statusData ? statusData.isOnline : Boolean(profileUser?.isOnline));

  const profileSubtitle = useMemo(() => {
    if (isMyProfile) return null;
    if (statusData) {
      return statusData.isOnline ? t('online', 'онлайн') : formatLastSeen(statusData.lastSeen, t);
    }
    return profileState.chat ? getChatSubtitle(profileState.chat, null, t) : null;
  }, [isMyProfile, statusData, profileState.chat, t]);

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
          isPeerOnline={isPeerOnline}
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

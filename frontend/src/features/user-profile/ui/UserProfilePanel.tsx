import { Spinner } from '@/shared/ui';
import { useProfileEdit } from '../model/useProfileEdit';
import {
  type IProfileState,
  userProfileQuery,
  userStatusQuery,
  ProfileHeader,
  ProfilePanelBar,
  ProfilePanelFallback,
  useProfileStore,
} from '@/entities/user';
import { useQuery } from '@tanstack/react-query';
import { formatLastSeen, formatLastSeenApprox, useNow } from '@/shared/lib';
import { getChatSubtitle } from '@/entities/chat';
import { memo, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileDetails } from './ProfileDetails';
import { ProfileSharedMedia } from './ProfileSharedMedia';

/** Звонок из профиля: в какой личный чат, кому и какой. */
export interface IProfileCall {
  chatId: string;
  peerId: string;
  peerName: string;
  kind: 'audio' | 'video';
}

/** Чей профиль открыт — для действий, которые приходят сверху. */
export interface IProfileActionsTarget {
  id: string;
  name: string;
}

interface Props {
  profileState: IProfileState;
  /**
   * Позвонить из профиля. Звонки — отдельная фича, панель о ней не знает:
   * действие приходит от того, кто собирает экран (#863). Нет его — нет и
   * кнопок звонка (так и сейчас, пока звонки выключены, #776 → #774).
   */
  startCall?: (call: IProfileCall) => void;
  onClose: () => void;
  /**
   * Действия с чужим профилем — сейчас блокировка (#727). Приходят от
   * страницы: блокировка — отдельная фича, и панель о ней не знает.
   */
  renderActions?: (target: IProfileActionsTarget) => ReactNode;
  /** «Назад» — когда профиль открыт из другой панели (участник группы). */
  onBack?: () => void;
  backLabel?: string;
  /**
   * «Изменить» своего профиля ведёт не в правку на месте, а сюда — в
   * настройках это отдельная форма (#828).
   */
  onEdit?: () => void;
  /** Своя полоса «Назад / Закрыть» сверху. В настройках её заменяет шапка раздела. */
  bar?: boolean;
}

export const UserProfilePanel = memo(
  ({
    profileState,
    startCall,
    onClose,
    renderActions,
    onBack,
    backLabel,
    onEdit,
    bar = true,
  }: Props) => {
    const { t } = useTranslation();
    const now = useNow();
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
    const { data: profileUser, isLoading, isError } = useQuery(userProfileQuery(targetUserId));
    const isMyProfile = Boolean(
      currentUser?.id && (currentUser.id === targetUserId || currentUser.id === profileUser?.id)
    );
    const { data: statusData } = useQuery(
      userStatusQuery(targetUserId, { enabled: !isMyProfile && !chat })
    );

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

    const isPeerOnline =
      !isMyProfile &&
      Boolean(chat ? chat.peerIsOnline : statusData ? statusData.isOnline : profileUser?.isOnline);

    const profileSubtitle = useMemo(() => {
      if (isMyProfile) return null;
      if (chat) return getChatSubtitle(chat, null, t, now);
      if (statusData) {
        if (statusData.isOnline) return t('online', 'онлайн');
        if (statusData.lastSeen) return formatLastSeen(statusData.lastSeen, t, { now });
        return formatLastSeenApprox(statusData.lastSeenApprox ?? 'long_ago', t);
      }
      return null;
    }, [isMyProfile, chat, statusData, t, now]);

    if (isLoading) {
      return (
        <ProfilePanelFallback ariaBusy backLabel={backLabel} onBack={onBack} onClose={onClose}>
          <div className="flex flex-col items-center gap-2">
            <Spinner size="md" />
            <span>{t('loading', 'Загрузка...')}</span>
          </div>
        </ProfilePanelFallback>
      );
    }

    if (isError || !profileUser) {
      return (
        <ProfilePanelFallback backLabel={backLabel} onBack={onBack} onClose={onClose}>
          <span className="text-danger">
            {t('profileLoadError', 'Не удалось загрузить профиль')}
          </span>
        </ProfilePanelFallback>
      );
    }

    /* Панель — по макету (#822): сверху «Назад» и «Закрыть», шапка без
     фона, плитки действий, «О себе», вкладки общего; внизу — блокировка. */
    return (
      <aside
        aria-label={t('profileOf', 'Профиль') + ': ' + displayName}
        className="flex h-full flex-col overflow-hidden bg-sheet"
        role="complementary"
      >
        {bar ? (
          <ProfilePanelBar backLabel={backLabel} onBack={onBack} onClose={onClose} />
        ) : (
          <div className="h-6 shrink-0" />
        )}

        <ProfileHeader
          /* Звонить есть куда — общий личный чат — и можно: блокировка в
           любую сторону звонки запрещает, сервер их отклонит (#760). */
          hasChat={Boolean(chat) && !chat?.isBlockedByPeer && !chat?.isPeerBlocked}
          isMyProfile={isMyProfile}
          isPeerOnline={isPeerOnline}
          onCall={
            startCall
              ? (kind) =>
                  chat &&
                  startCall({
                    chatId: chat.id,
                    peerId: profileUser.id,
                    peerName: profileUser.username,
                    kind,
                  })
              : undefined
          }
          onStartEdit={onEdit ?? startEdit}
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

        {chat ? <ProfileSharedMedia messages={chatMessages ?? []} /> : <div className="flex-1" />}

        {/* Блокировка — из профиля человека, как в Telegram (#727). */}
        {!isMyProfile && profileUser.id && renderActions && (
          <div className="shrink-0 px-4 pt-2 pb-4">
            {renderActions({ id: profileUser.id, name: displayName })}
          </div>
        )}
      </aside>
    );
  }
);

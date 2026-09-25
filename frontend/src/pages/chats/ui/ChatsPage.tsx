import { ChatsList } from '@/widgets/chats-list';
import { CreateGroupModal } from '@/features/group-management';
import { UserProfilePanel } from '@/features/user-profile';
import { useIsMobile, usePaneWidth } from '@/shared/lib';
import { PaneResizer } from '@/shared/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useParams } from 'react-router-dom';
import type { IProfileState } from '@/entities/user';

/* Границы ширины колонок. Ниже нижней строка чата перестаёт помещаться,
   выше верхней колонка съедает переписку. */
const SIDEBAR_LIMITS = { min: 280, max: 520, fallback: 360 };
const PROFILE_LIMITS = { min: 300, max: 560, fallback: 380 };

export function ChatsPage() {
  const { chatId } = useParams();
  const isMobile = useIsMobile();
  const sidebar = usePaneWidth('sidebar', SIDEBAR_LIMITS);
  const profile = usePaneWidth('profile', PROFILE_LIMITS);
  const [profileState, setProfileState] = useState<IProfileState>({
    isOpen: false,
    userId: null,
    chat: null,
    messages: [],
  });
  const [profileCloseToken, setProfileCloseToken] = useState(0);
  const [isCreateGroupOpen, setCreateGroupOpen] = useState(false);
  const { t } = useTranslation();

  function startResize(kind: 'sidebar' | 'profile', event: PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const pane = kind === 'sidebar' ? sidebar : profile;
    const limits = kind === 'sidebar' ? SIDEBAR_LIMITS : PROFILE_LIMITS;
    const startWidth = pane.width;
    let lastWidth = startWidth;

    function handleMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      // Панель профиля растёт влево, поэтому смещение у неё с обратным знаком.
      const raw = kind === 'sidebar' ? startWidth + delta : startWidth - delta;

      lastWidth = Math.min(Math.max(raw, limits.min), limits.max);
      pane.setWidth(lastWidth);
    }

    function handleUp() {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      // Записывается один раз, по концу: иначе одно перетаскивание даёт
      // несколько сотен обращений к хранилищу.
      pane.remember(lastWidth);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  const createGroupModal = isCreateGroupOpen ? (
    <CreateGroupModal onClose={() => setCreateGroupOpen(false)} />
  ) : null;

  if (isMobile) {
    if (chatId) {
      return (
        <Outlet
          context={{
            onProfileStateChange: setProfileState,
            profileCloseToken,
            profileMode: 'modal',
          }}
        />
      );
    }
    return (
      <>
        {createGroupModal}
        <ChatsList onOpenCreateGroup={() => setCreateGroupOpen(true)} />
      </>
    );
  }

  return (
    <div className={`chat-workspace ${profileState.isOpen ? 'has-profile' : ''}`}>
      {/* Окно рисуется вне колонки списка: у той backdrop-filter, а он
          делает position: fixed относительным ей, и окно оказывалось
          прижатым к узкой колонке вместо экрана. */}
      {createGroupModal}
      <div className="app-sidebar-pane" style={{ flexBasis: sidebar.width }}>
        <ChatsList onOpenCreateGroup={() => setCreateGroupOpen(true)} />
      </div>

      <PaneResizer
        className="app-pane-resizer app-pane-resizer-sidebar"
        label={t('resizeChatList', 'Изменить ширину списка чатов')}
        max={SIDEBAR_LIMITS.max}
        min={SIDEBAR_LIMITS.min}
        onPointerDown={(event) => startResize('sidebar', event.nativeEvent)}
        onJump={sidebar.jump}
        onNudge={sidebar.nudge}
        width={sidebar.width}
      />

      <div className="app-chat-pane">
        <Outlet
          context={{
            onProfileStateChange: setProfileState,
            profileCloseToken,
            profileMode: 'panel',
          }}
        />
      </div>

      {profileState.isOpen && (
        <>
          <PaneResizer
            className="app-pane-resizer app-pane-resizer-profile"
            label={t('resizeProfile', 'Изменить ширину профиля')}
            max={PROFILE_LIMITS.max}
            min={PROFILE_LIMITS.min}
            onPointerDown={(event) => startResize('profile', event.nativeEvent)}
            onJump={profile.jump}
            onNudge={profile.nudge}
            width={profile.width}
          />
          <div className="app-profile-pane" style={{ flexBasis: profile.width }}>
            <UserProfilePanel
              onClose={() => {
                setProfileState({ isOpen: false, userId: null, chat: null, messages: [] });
                setProfileCloseToken((value) => value + 1);
              }}
              profileState={profileState}
            />
          </div>
        </>
      )}
    </div>
  );
}

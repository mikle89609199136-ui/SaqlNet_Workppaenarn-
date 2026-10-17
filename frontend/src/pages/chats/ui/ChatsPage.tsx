import { ChatsList } from '@/widgets/chats-list';
import { CreateGroupModal } from '@/features/group-management';
import { GroupInfoPanel } from '@/widgets/group-info';
import { setCallStage, useCall } from '@/features/call';
import { CALLS_ENABLED } from '@/shared/config';
import { SavedMessagesPanel, UserProfilePanel } from '@/features/user-profile';
import { cn, useIsMobile, usePaneWidth } from '@/shared/lib';
import { PaneResizer } from '@/shared/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useParams } from 'react-router-dom';
import type { IProfileState } from '@/entities/user';
import { BlockUserButton } from '@/features/block-user';
import type { IProfileActionsTarget, IProfileCall } from '@/features/user-profile';

/* Действия с чужим профилем — блокировка (#727). На уровне модуля:
   стабильная ссылка не перерисовывает мемоизированную панель. */
const renderProfileActions = ({ id, name }: IProfileActionsTarget) => (
  <BlockUserButton className="w-full py-3 text-ui font-medium" name={name} userId={id} />
);

/* Границы ширины списка при перетаскивании. Ниже нижней строка чата
   перестаёт помещаться, выше верхней колонка съедает переписку. */
const SIDEBAR_LIMITS = { min: 280, max: 520, fallback: 360 };

/* Движение правой панели — из макета: ширина за 320ms, содержимое
   въезжает на 48px и проявляется. */
const PANEL_MS = 320;
const PANEL_EASE = 'ease-[cubic-bezier(0.2,0.8,0.2,1)]';

const CLOSED_PROFILE: IProfileState = { isOpen: false, userId: null, chat: null };

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Раскладка чатов (#818) — по доскам макета.
 *
 * ПК и планшет: панели-карточки на фоне окна — список, переписка и правая
 * панель профиля. На ПК и планшете горизонтально панель раздвигает
 * переписку, на планшете вертикально ложится поверх с затемнением: ширины
 * на три колонки там нет. Телефон — экраны по очереди, главный — список;
 * профиль открывает сам экран чата.
 */
export function ChatsPage() {
  const { chatId } = useParams();
  const isMobile = useIsMobile();
  const sidebar = usePaneWidth('sidebar', SIDEBAR_LIMITS);
  const listRef = useRef<HTMLDivElement>(null);
  const [profileState, setProfileState] = useState<IProfileState>(CLOSED_PROFILE);
  const [profileCloseToken, setProfileCloseToken] = useState(0);
  const [isCreateGroupOpen, setCreateGroupOpen] = useState(false);
  const { t } = useTranslation();
  /* Звонок из профиля (#863): профиль о звонках не знает — действие даёт
     страница, пока звонки включены. */
  const { initiateCall } = useCall();
  const startProfileCall = useMemo(
    () =>
      CALLS_ENABLED
        ? ({ chatId, peerId, peerName, kind }: IProfileCall) =>
            initiateCall(chatId, 'private', peerName, kind, peerId)
        : undefined,
    [initiateCall]
  );

  /* Панель уезжает с анимацией, поэтому её содержимое живёт ещё
     PANEL_MS после закрытия — иначе оно пропало бы в первый же кадр, и
     уезжала бы пустая рамка. */
  const [leavingProfile, setLeavingProfile] = useState<IProfileState | null>(null);
  const profileOpen = profileState.isOpen;

  // Открытое запоминается прямо при отрисовке, а не эффектом: лишний
  // проход отрисовки ради копии состояния ни к чему.
  if (profileOpen && leavingProfile !== profileState) setLeavingProfile(profileState);

  useEffect(() => {
    if (profileOpen) return undefined;

    const timer = setTimeout(() => setLeavingProfile(null), prefersReducedMotion() ? 0 : PANEL_MS);
    return () => clearTimeout(timer);
  }, [profileOpen]);

  const shownProfile = profileOpen ? profileState : leavingProfile;

  const closeProfile = () => {
    setProfileState(CLOSED_PROFILE);
    setProfileCloseToken((value) => value + 1);
  };

  /* Пока ширину не задавали руками, колонка берёт её из раскладки, и
     разделитель должен знать настоящую — для диктора и для первого
     перетаскивания, которое начинается от того, что на экране. */
  const [measuredWidth, setMeasuredWidth] = useState(sidebar.width);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(([entry]) => {
      setMeasuredWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [isMobile]);

  const listWidth = sidebar.custom ? sidebar.width : measuredWidth;

  function startResize(event: PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = listWidth;
    let lastWidth = startWidth;

    function handleMove(moveEvent: PointerEvent) {
      const raw = startWidth + moveEvent.clientX - startX;
      lastWidth = Math.min(Math.max(raw, SIDEBAR_LIMITS.min), SIDEBAR_LIMITS.max);
      sidebar.setWidth(lastWidth);
    }

    function handleUp() {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      // Записывается один раз, по концу: иначе одно перетаскивание даёт
      // несколько сотен обращений к хранилищу.
      sidebar.remember(lastWidth);
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
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {createGroupModal}

      <div
        ref={listRef}
        className={cn(
          'flex shrink-0 flex-col overflow-hidden rounded-window bg-sheet',
          !sidebar.custom && 'w-75 lg:w-80 xl:w-90'
        )}
        style={sidebar.custom ? { width: sidebar.width } : undefined}
      >
        <ChatsList onOpenCreateGroup={() => setCreateGroupOpen(true)} />
      </div>

      {/* Зазор между панелями и есть ручка: за него тянут, на наведении и
          в фокусе по нему проходит линия акцента. */}
      <PaneResizer
        className={cn(
          'relative w-2.5 shrink-0 cursor-col-resize outline-none xl:w-3',
          'after:absolute after:inset-y-4 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-pill',
          'after:transition-colors after:duration-fast hover:after:bg-brand focus-visible:after:bg-brand'
        )}
        label={t('resizeChatList', 'Изменить ширину списка чатов')}
        max={SIDEBAR_LIMITS.max}
        min={SIDEBAR_LIMITS.min}
        onPointerDown={(event) => startResize(event.nativeEvent)}
        onJump={sidebar.jump}
        onNudge={(delta) => {
          if (!sidebar.custom) sidebar.setWidth(listWidth);
          sidebar.nudge(delta);
        }}
        width={listWidth}
      />

      {/* app-chat-pane — зацепка для стилей ленты (tailwind.css). */}
      <div
        className="app-chat-pane relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-window bg-chat-bg"
        ref={setCallStage}
      >
        <Outlet
          context={{
            onProfileStateChange: setProfileState,
            profileCloseToken,
            profileMode: 'panel',
          }}
        />
      </div>

      {/* Затемнение — только там, где панель ложится поверх переписки. */}
      {profileOpen && (
        <button
          aria-label={t('closePanel', 'Закрыть панель')}
          className="fixed inset-0 z-15 cursor-default bg-backdrop lg:hidden"
          onClick={closeProfile}
          tabIndex={-1}
          type="button"
        />
      )}

      <div
        className={cn(
          'group shrink-0 overflow-hidden rounded-window',
          `transition-[width,margin] duration-[320ms] ${PANEL_EASE} motion-reduce:transition-none`,
          'w-0 data-[state=open]:w-85',
          'max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:data-[state=open]:shadow-[var(--shadow-menu)]',
          'lg:data-[state=open]:ml-2.5 lg:data-[state=open]:w-75 xl:data-[state=open]:ml-3 xl:data-[state=open]:w-80'
        )}
        data-state={profileOpen ? 'open' : 'closed'}
        id="profile-slot"
        inert={!profileOpen}
      >
        {shownProfile && (
          <div
            className={cn(
              /* Ширина своя, не панели: пока панель раздвигается, текст
                 внутри не должен переливаться по строкам. */
              'h-full w-85 overflow-hidden rounded-window bg-sheet lg:w-75 xl:w-80',
              `[transition:transform_320ms_cubic-bezier(0.2,0.8,0.2,1),opacity_240ms_ease] motion-reduce:transition-none`,
              'starting:translate-x-12 starting:opacity-0',
              'group-data-[state=closed]:translate-x-12 group-data-[state=closed]:opacity-0'
            )}
          >
            {shownProfile.kind === 'group' && chatId ? (
              <GroupInfoPanel
                chatId={chatId}
                key={chatId}
                onClose={closeProfile}
                startCall={startProfileCall}
              />
            ) : shownProfile.kind === 'saved' && chatId ? (
              // «Избранное»: вместо профиля — общее в нём (#1075).
              <SavedMessagesPanel chatId={chatId} key={chatId} onClose={closeProfile} />
            ) : (
              <UserProfilePanel
                onClose={closeProfile}
                profileState={shownProfile}
                renderActions={renderProfileActions}
                startCall={startProfileCall}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

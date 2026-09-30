import { useCall } from '@/features/call';
import type { IProfileModal } from '@/entities/user';
import { chatQuery, getChatSubtitle, onlineMembersQuery, useTypingLabel } from '@/entities/chat';
import { cn, useNow } from '@/shared/lib';
import { useQuery } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Button, buttonStyles, Icon } from '@/shared/ui';
import { CALLS_ENABLED } from '@/shared/config';

interface Props {
  profileModal?: IProfileModal;
  setProfileModal?: Dispatch<SetStateAction<IProfileModal>>;
  locationPage?: 'pinned-messages' | 'chat-thread';
  onClosePinnedMessagePage?: () => void;
}

export const ChatThreadHeader = ({
  profileModal,
  setProfileModal,
  locationPage = 'chat-thread',
  onClosePinnedMessagePage,
}: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { chatId = '' } = useParams<{ chatId: string }>();
  // Заголовок читает чат из кеша запросов — того же, что наполняет страница.
  const { data: chat } = useQuery(chatQuery(chatId));
  const { data: onlineMembers } = useQuery({
    ...onlineMembersQuery(chatId),
    enabled: chat?.type === 'group' && locationPage === 'chat-thread',
  });
  const { initiateCall } = useCall();
  const typingLabel = useTypingLabel(chat);
  // «Был(а) 5 минут назад» пересчитывается, пока шапка открыта.
  const now = useNow();

  if (!chat) return;

  // О связи говорит плашка под шапкой (ConnectionBanner, #826); подзаголовок
  // — всегда о собеседнике.
  const subtitle = getChatSubtitle(chat, typingLabel, t, now, onlineMembers?.length);
  const isPeerOnline = Boolean(chat.type === 'private' && chat?.peerIsOnline);
  // Блокировка в любую сторону — звонков нет (#760).
  const callsBlocked = Boolean(chat.isBlockedByPeer || chat.isPeerBlocked);
  const isGroup = chat.type === 'group';
  const profileOpen = Boolean(profileModal?.isOpen);

  // Клик по шапке только называет, чей профиль показать: запрос делает
  // панель, и повторное открытие обходится кешем (#232).
  function openChatProfile() {
    if (!setProfileModal) return;

    if (profileModal?.isOpen) {
      setProfileModal({ isOpen: false, userId: null });
      return;
    }

    if (chat?.type === 'group') {
      setProfileModal({ isOpen: true, userId: null, kind: 'group' });
      return;
    }
    if (chat?.type !== 'private' || !chat.peerId) return;

    setProfileModal({ isOpen: true, userId: chat.peerId });
  }

  /* Шапка — по макету (#822): 64px, снизу линия. На телефоне слева
     «Назад к чатам», дальше одна кнопка «аватар и имя», открывающая
     панель, справа кнопки 40×40 цвета ink-2. */
  const headerClass =
    'z-5 flex h-16 shrink-0 items-center gap-1.5 border-b border-divider bg-chat-bg px-1.5 md:px-3 ' +
    'max-md:sticky max-md:top-0 max-md:h-[calc(64px+env(safe-area-inset-top,0px))] max-md:pt-[env(safe-area-inset-top,0px)]';

  const backToChats = (
    <Link
      aria-label={t('backToChats', 'Назад к чатам')}
      className={buttonStyles({ variant: 'accent', iconOnly: true, className: 'md:hidden' })}
      to="/chats"
    >
      <Icon className="size-5.5 rotate-180 stroke-2" name="chevronRight" />
    </Link>
  );

  if (locationPage === 'pinned-messages') {
    return (
      <header className={headerClass}>
        <Button
          aria-label={t('back', 'Назад')}
          className="text-brand"
          iconOnly
          onClick={onClosePinnedMessagePage}
          variant="ghost"
        >
          <Icon className="size-5.5 rotate-180 stroke-2" name="chevronRight" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-subtitle font-semibold">
          {t('pinnedMessagesTitle', 'Закреплённые сообщения')}
        </h1>
      </header>
    );
  }

  return (
    <header className={headerClass}>
      {backToChats}

      <button
        aria-controls="profile-slot"
        aria-expanded={profileOpen}
        aria-label={`${chat.title} — ${
          profileOpen
            ? t('hideProfile', 'скрыть')
            : isGroup
              ? t('openGroupInfo', 'открыть сведения')
              : t('openProfile', 'открыть профиль')
        }`}
        className={cn(
          'flex h-13 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-button pr-3 pl-1.5 text-left',
          'transition-colors duration-fast hover:layer-hover aria-expanded:bg-sheet-2',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2'
        )}
        onClick={openChatProfile}
        type="button"
      >
        <Avatar
          id={chat.type === 'private' ? chat.peerId : null}
          name={chat.title}
          online={isPeerOnline}
          size="md"
          src={chat.avatarUrl}
          surface="chat"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-subtitle leading-[1.25] font-semibold">{chat.title}</span>
          <span
            className={cn(
              'truncate text-caption leading-[1.3] text-ink-2',
              (isPeerOnline || typingLabel) && 'text-brand'
            )}
          >
            {subtitle}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        {/* Поиск по переписке появится с #841. */}
        {/* Звонки выключены до нового экрана (#774): старый удалён в #776. */}
        {CALLS_ENABLED && (
          <>
            <Button
              aria-label={t('audioCall', 'Позвонить')}
              disabled={callsBlocked}
              iconOnly
              onClick={() => initiateCall(chatId, chat.type, chat.title, 'audio', chat?.peerId)}
              title={t('audioCall', 'Позвонить')}
              variant="ghost"
            >
              <Icon className="size-5" name="phone" />
            </Button>
            <Button
              aria-label={t('videoCall', 'Видеозвонок')}
              disabled={callsBlocked}
              iconOnly
              onClick={() => initiateCall(chatId, chat?.type, chat.title, 'video', chat?.peerId)}
              title={t('videoCall', 'Видеозвонок')}
              variant="ghost"
            >
              <Icon className="size-5" name="video" />
            </Button>
          </>
        )}
        <Button
          aria-label={t('closeChat', 'Закрыть чат')}
          className="max-md:hidden"
          iconOnly
          onClick={() => navigate('/chats')}
          title={t('closeChat', 'Закрыть чат')}
          variant="ghost"
        >
          <Icon className="size-5" name="cross" />
        </Button>
      </div>
    </header>
  );
};

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router-dom';
import { useChatUiStore } from '@/entities/chat';
import { ProfilePanelBar } from '@/entities/user';
import { REACT_ROUTES, ROUTES } from '@/shared/config';
import { Avatar } from '@/shared/ui';
import { ProfileSharedMedia } from './ProfileSharedMedia';

interface Props {
  chatId: string;
  onClose: () => void;
  /** В окне на телефоне после перехода к сообщению окно закрывается. */
  closeOnJump?: boolean;
}

/**
 * Панель «Избранного» (#1075): вместо профиля собеседника — значок,
 * название и общее в этом чате: медиа, файлы, ссылки. Профиля здесь нет:
 * чат с самим собой.
 */
export function SavedMessagesPanel({ chatId, onClose, closeOnJump = false }: Props) {
  const { t } = useTranslation();
  const title = t('savedMessages.title', 'Избранное');

  /* Переход к сообщению из общего — как в профиле (#842): запрос выполнит
     лента чата. */
  const navigate = useNavigate();
  const openChatId = useMatch(REACT_ROUTES.CHAT_BY_ID)?.params.chatId;
  const setJumpRequest = useChatUiStore((state) => state.setJumpRequest);
  const jumpToMessage = useCallback(
    (messageId: string) => {
      setJumpRequest({ chatId, messageId });
      if (openChatId !== chatId) navigate(ROUTES.CHAT_BY_ID(chatId));
      if (closeOnJump) onClose();
    },
    [chatId, closeOnJump, navigate, onClose, openChatId, setJumpRequest]
  );

  return (
    <aside
      aria-label={title}
      className="flex h-full flex-col overflow-hidden bg-sheet"
      role="complementary"
    >
      <ProfilePanelBar onClose={onClose} />
      <div className="flex shrink-0 flex-col items-center gap-3 px-4 pt-2 pb-4">
        <Avatar icon="bookmark" name={title} size="2xl" />
        <h2 className="text-section font-semibold text-ink">{title}</h2>
      </div>
      <ProfileSharedMedia chatId={chatId} onJumpToMessage={jumpToMessage} />
    </aside>
  );
}

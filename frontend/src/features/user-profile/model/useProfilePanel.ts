import type { IProfileModal, IProfileState } from '@/entities/user';
import type { IChatDto } from '@/entities/chat';
import type { TMessagesList } from '@/entities/message';
import { useEffect, useState } from 'react';

const CLOSED_PROFILE: IProfileModal = { isOpen: false, userId: null };

interface Params {
  chat: IChatDto | null;
  messages: TMessagesList;
  chatId: string;
  profileMode: 'modal' | 'panel';
  profileCloseToken: number;
  onProfileStateChange: (state: IProfileState) => void;
}

export function useProfilePanel({
  chat,
  messages,
  chatId,
  profileMode,
  profileCloseToken,
  onProfileStateChange,
}: Params) {
  const [profileModal, setProfileModal] = useState<IProfileModal>(CLOSED_PROFILE);

  /* Профиль привязан к чату и к запросу на закрытие: при переходе в
     соседний чат и по кнопке «закрыть» в панели он должен схлопнуться.

     Сброс сделан сравнением во время отрисовки, а не эффектом. Эффект
     сбрасывал бы состояние после того, как React уже нарисовал кадр со
     старым: панель успевала мигнуть чужим профилем. Приём описан в
     документации React как «adjusting state when a prop changes» —
     React перерисует сразу, промежуточный кадр наружу не попадёт. */
  const [seenChatId, setSeenChatId] = useState(chatId);
  const [seenCloseToken, setSeenCloseToken] = useState(profileCloseToken);

  if (chatId !== seenChatId || profileCloseToken !== seenCloseToken) {
    setSeenChatId(chatId);
    setSeenCloseToken(profileCloseToken);
    setProfileModal(CLOSED_PROFILE);
  }

  useEffect(() => {
    if (profileMode !== 'panel' || typeof onProfileStateChange !== 'function') return;
    // Лента нужна панели только чтобы отобрать общие медиа, и только пока
    // панель открыта. Закрытой отдавать её незачем: ссылка осталась бы в
    // состоянии ChatsPage, которая при переходе между чатами не
    // размонтируется, и держала бы расшифрованные сообщения чата, из
    // которого профиль когда-то открывали.
    onProfileStateChange({ ...profileModal, chat, messages: profileModal.isOpen ? messages : [] });
  }, [chat, messages, onProfileStateChange, profileMode, profileModal]);

  return { profileModal, setProfileModal };
}

import type { IProfileModal, IProfileState } from '@/entities/user';
import type { IChatDto } from '@/types';
import { useEffect, useState } from 'react';

const CLOSED_PROFILE: IProfileModal = { isOpen: false, userId: null };

interface Params {
  chat: IChatDto | null;
  chatId: string;
  profileMode: 'modal' | 'panel';
  profileCloseToken: number;
  onProfileStateChange: (state: IProfileState) => void;
}

export function useProfilePanel({
  chat,
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
    // Ленту панели не отдаём: общее в профиле сервер отдаёт по виду (#842).
    onProfileStateChange({ ...profileModal, chat });
  }, [chat, onProfileStateChange, profileMode, profileModal]);

  return { profileModal, setProfileModal };
}

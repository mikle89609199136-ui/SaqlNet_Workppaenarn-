import type { IProfileModal, IProfileState } from '@/pages/ChatThreadPage/ChatThreadPage';
import type { IChatDto, TMessagesList } from '@/types';
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

  // Профиль привязан к конкретному чату: при переходе в соседний не должен оставаться открытым.
  useEffect(() => {
    setProfileModal(CLOSED_PROFILE);
  }, [chatId]);

  useEffect(() => {
    if (profileMode !== 'panel' || typeof onProfileStateChange !== 'function') return;
    // Лента нужна панели только чтобы отобрать общие медиа, и только пока
    // панель открыта. Закрытой отдавать её незачем: ссылка осталась бы в
    // состоянии ChatsPage, которая при переходе между чатами не
    // размонтируется, и держала бы расшифрованные сообщения чата, из
    // которого профиль когда-то открывали.
    onProfileStateChange({ ...profileModal, chat, messages: profileModal.isOpen ? messages : [] });
  }, [chat, messages, onProfileStateChange, profileMode, profileModal]);

  useEffect(() => {
    if (profileCloseToken === 0) return;
    setProfileModal(CLOSED_PROFILE);
  }, [profileCloseToken]);

  return { profileModal, setProfileModal };
}

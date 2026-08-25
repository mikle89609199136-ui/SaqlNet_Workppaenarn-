import { chatQuery } from '@/queries/chat/threadQueries';
import { useThreadMessagesData } from '@/queries/chat/useThreadMessagesData';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { UserProfilePanel } from '../UserProfilePanel';
import type { IProfileModal } from '@/pages';

interface Props {
  onClose: () => void;
  profileModal: IProfileModal;
}

export const UserProfileModal = ({ onClose, profileModal }: Props) => {
  const { chatId = '' } = useParams<{ chatId: string }>();
  // Панель показывает общие медиа, поэтому ей нужна история открытого чата.
  const { data: chat = null } = useQuery(chatQuery(chatId));
  const messages = useThreadMessagesData();

  if (!profileModal.isOpen) return null;

  return (
    <div className="user-profile-modal" onClick={onClose} role="presentation">
      <UserProfilePanel profileState={{ ...profileModal, chat, messages }} onClose={onClose} />
    </div>
  );
};

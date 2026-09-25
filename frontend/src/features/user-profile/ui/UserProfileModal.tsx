import { chatQuery } from '@/entities/chat';
import { useThreadMessagesData } from '@/entities/message';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { UserProfilePanel } from './UserProfilePanel';
import type { IProfileModal } from '@/entities/user';

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
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center p-0 md:p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="w-full h-full h-[100dvh] md:h-auto md:max-h-[650px] md:max-w-[420px] rounded-none md:rounded-window overflow-hidden border-0 md:border md:border-line bg-sheet shadow-none md:shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <UserProfilePanel profileState={{ ...profileModal, chat, messages }} onClose={onClose} />
      </div>
    </div>
  );
};

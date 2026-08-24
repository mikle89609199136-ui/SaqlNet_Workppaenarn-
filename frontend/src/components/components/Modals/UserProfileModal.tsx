import { useChatStore } from '@/store';
import { UserProfilePanel } from '../UserProfilePanel';
import type { IProfileModal } from '@/pages';

interface Props {
  onClose: () => void;
  profileModal: IProfileModal;
}

export const UserProfileModal = ({ onClose, profileModal }: Props) => {
  const { messages, chat } = useChatStore();
  if (!profileModal.isOpen) return null;

  return (
    <div className="user-profile-modal" onClick={onClose} role="presentation">
      <UserProfilePanel profileState={{ ...profileModal, chat, messages }} onClose={onClose} />
    </div>
  );
};

import { useChatStore } from "../../../store/chat";
import { UserProfilePanel } from "../ProfilePanel/UserProfilePanel";

export const UserProfileModal = ({ onClose, profileModal }) => {
  const { messages, chat } = useChatStore();
  if (!profileModal.isOpen) return null;

  return (
    <div className="user-profile-modal" onClick={onClose} role="presentation">
      <UserProfilePanel
        profileState={{ ...profileModal, chat, messages }}
        onClose={onClose}
        stopPropagation
      />
    </div>
  );
};

import { chatQuery } from '@/entities/chat';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  UserProfilePanel,
  type IProfileActionsTarget,
  type IProfileCall,
} from './UserProfilePanel';
import type { IProfileModal } from '@/entities/user';

interface Props {
  onClose: () => void;
  renderActions?: (target: IProfileActionsTarget) => ReactNode;
  profileModal: IProfileModal;
  /** Позвонить из профиля — от страницы, см. UserProfilePanel. */
  startCall?: (call: IProfileCall) => void;
}

export const UserProfileModal = ({ onClose, profileModal, renderActions, startCall }: Props) => {
  const { chatId = '' } = useParams<{ chatId: string }>();
  // Панель показывает общее в этом чате.
  const { data: chat = null } = useQuery(chatQuery(chatId));

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
        <UserProfilePanel
          closeOnJump
          onClose={onClose}
          profileState={{ ...profileModal, chat }}
          renderActions={renderActions}
          startCall={startCall}
        />
      </div>
    </div>
  );
};

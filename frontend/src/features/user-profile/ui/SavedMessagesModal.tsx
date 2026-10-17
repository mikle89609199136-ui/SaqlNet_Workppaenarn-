import { useParams } from 'react-router-dom';
import { SavedMessagesPanel } from './SavedMessagesPanel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Панель «Избранного» окном поверх переписки — на телефоне (#1075). */
export const SavedMessagesModal = ({ isOpen, onClose }: Props) => {
  const { chatId = '' } = useParams<{ chatId: string }>();

  if (!isOpen || !chatId) return null;

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/50 p-0 backdrop-blur-sm md:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="h-[100dvh] w-full overflow-hidden rounded-none border-0 bg-sheet shadow-none md:h-auto md:max-h-[650px] md:max-w-[420px] md:rounded-window md:border md:border-line md:shadow-[var(--elev-3)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <SavedMessagesPanel chatId={chatId} closeOnJump onClose={onClose} />
      </div>
    </div>
  );
};

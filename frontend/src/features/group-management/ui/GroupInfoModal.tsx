import { useParams } from 'react-router-dom';
import { GroupInfoPanel } from './GroupInfoPanel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Сведения о группе на телефоне — отдельным экраном поверх чата (#822).
 *
 * На ПК и планшете та же панель открывается справа, в месте профиля
 * (ChatsPage); здесь — во весь экран, с той же «Закрыть» и «Назад».
 */
export function GroupInfoModal({ isOpen, onClose }: Props) {
  const { chatId = '' } = useParams<{ chatId: string }>();

  if (!isOpen || !chatId) return null;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[1300] flex bg-sheet pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
      role="dialog"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <GroupInfoPanel chatId={chatId} onClose={onClose} />
      </div>
    </div>
  );
}

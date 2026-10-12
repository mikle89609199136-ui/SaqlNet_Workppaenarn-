import type { IActionMenu } from '@/entities/chat';
import type { IMessageDto } from '@/types';
import { useCallback, type KeyboardEvent } from 'react';
import { menuPointNear, opensMessageMenu } from './messageMenu';

interface Params {
  message: IMessageDto;
  selectionMode: boolean;
  onSelection: (message: IMessageDto) => void;
  setActionMenu: (actionMenu: IActionMenu | null) => void;
}

export function useMessageMenuKeys({ message, selectionMode, onSelection, setActionMenu }: Params) {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget || !opensMessageMenu(event)) return;
      event.preventDefault();

      if (selectionMode) {
        onSelection(message);
        return;
      }
      setActionMenu({ messageId: message.id, ...menuPointNear(event.currentTarget) });
    },
    [message, onSelection, selectionMode, setActionMenu]
  );
}

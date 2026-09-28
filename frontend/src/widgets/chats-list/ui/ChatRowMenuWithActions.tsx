import { ChatRowMenu, type IChatRowMenuProps } from '@/features/chat-actions';
import { useBlockFlow } from '@/features/block-user';
import { useLeaveGroupFlow } from '@/features/group-management';

/**
 * Меню строки чата вместе с блокировкой собеседника (#727) и выходом из
 * группы (#90).
 *
 * Собирается здесь, в виджете: меню, блокировка и управление группой —
 * разные фичи, и друг о друге не знают. Признак блокировки несёт сам чат
 * (isPeerBlocked), поэтому чёрный список ради меню не читается. Пока
 * открыто подтверждение, меню спрятано, а закрывает всё уже диалог.
 */
export function ChatRowMenuWithActions(props: IChatRowMenuProps) {
  const { chat, onClose } = props;
  const flow = useBlockFlow({ withBlockedList: false, onDone: onClose });
  const leave = useLeaveGroupFlow({ onDone: onClose });
  const peerId = chat.type === 'private' ? chat.peerId : undefined;

  return (
    <>
      <ChatRowMenu
        {...props}
        block={
          peerId
            ? {
                blocked: Boolean(chat.isPeerBlocked),
                onBlock: () => flow.requestBlock(peerId, chat.title),
                onUnblock: () => flow.unblock(peerId),
              }
            : undefined
        }
        hidden={flow.isConfirming || leave.isConfirming}
        onLeave={chat.type === 'group' ? () => leave.requestLeave(chat) : undefined}
      />
      {flow.dialog}
      {leave.dialog}
    </>
  );
}

import { Badge } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import type { IChatDto } from '@/types';
import { useTranslation } from 'react-i18next';

interface Props {
  chats: IChatDto[];
  onOpen: () => void;
}

/**
 * Вход в архив — первой строкой списка.
 *
 * Пустой архив не показывается вовсе: строка, которая ведёт в пустоту,
 * занимает место в самом заметном углу списка и ничего не сообщает.
 *
 * Непрочитанные считаются по всем архивным сразу: разбираться, в каком
 * именно чате они лежат, человек будет уже внутри.
 */
export function ArchiveEntry({ chats, onOpen }: Props) {
  const { t } = useTranslation();

  if (chats.length === 0) return null;

  const unread = chats.reduce((total, chat) => total + (chat.unreadCount || 0), 0);
  const names = chats
    .map((chat) => chat.title)
    .filter(Boolean)
    .join(', ');

  return (
    <button className="chat-row w-full text-left" onClick={onOpen} type="button">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-sheet-2 text-ink-2">
        <Icon name="download" />
      </span>

      <div className="chat-main">
        <div className="chat-topline">
          <span className="chat-title">{t('archive', 'Архив')}</span>
        </div>
        <div className="chat-subline">
          <span>{names}</span>
          {unread > 0 && (
            <Badge label={`${unread} ${t('unreadMessages', 'непрочитанных')}`} tone="quiet">
              {unread}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

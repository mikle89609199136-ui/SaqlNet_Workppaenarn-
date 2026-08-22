import { MessageCheckbox } from '@/components/ui';
import { useMessageLongPress } from '@/hooks';
import { useChatStore } from '@/store';
import type { IMessageDto } from '@/types';
import { cn, formatMessageTime, hasMessageMedia } from '@/utils';
import { memo, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { CallMessageContent } from './CallMessageContent';
import { MessageContentRenderer } from './MessageContent';
import { MessageMedia } from './MessageMedia';

interface Props {
  currentUserId: string;
  message: IMessageDto;
  translations: Record<string, string>;
  onOpenImage: Dispatch<SetStateAction<string | null>>;
  onSelection: (message: IMessageDto) => void;
}

export const MessageBubble = memo(
  ({ currentUserId, message, translations, onOpenImage, onSelection }: Props) => {
    const setActionMenu = useChatStore((state) => state.setActionMenu);
    const actionMenu = useChatStore((state) => state.actionMenu);
    const isActionTarget = useChatStore((state) => state.actionMenu?.messageId === message.id);
    const selectionMode = useChatStore((state) => state.selectionMode);
    const isSelected = useChatStore((state) =>
      state.selectedMessages.some(({ id }) => id === message.id)
    );
    const repliedMessage = useChatStore((state) =>
      message.replyTo ? state.messages.find(({ id }) => id === message.replyTo) : null
    );

    const { t } = useTranslation();
    const mine = message.senderId === currentUserId;

    const longPressHandlers = useMessageLongPress(
      message.id,
      selectionMode,
      onSelection,
      actionMenu,
      setActionMenu,
      message
    );

    const replyText = repliedMessage?.content?.trim() || message.replyToContent?.trim() || '';
    const replyImage = repliedMessage?.mediaUrl || message.replyToMediaUrl || null;

    return (
      <article
        id={message.id}
        className={cn('flex justify-between gap-x-2', mine && 'justify-end')}
        {...longPressHandlers}
      >
        <div
          className={`message-bubble ${mine ? 'is-mine' : ''} ${hasMessageMedia(message) ? 'has-media' : ''} ${isActionTarget ? 'is-action-target' : ''} ${isSelected ? 'is-selected bg-accent' : ''}`}
        >
          {!mine && message.senderStatusEmoji && (
            <div className="message-sender">
              <span className="sender-status-emoji" style={{ marginLeft: 6 }}>
                {message.senderStatusEmoji}
              </span>
            </div>
          )}

          {(replyText || replyImage) && (
            <a
              href={`#${message.replyTo}`}
              className="message-reply-preview"
              aria-label={t('goToMessage', 'Перейти к сообщению')}
            >
              {replyImage && (
                <img src={replyImage} alt="" className="message-reply-preview-image" />
              )}
              {replyText && <span>{replyText}</span>}
            </a>
          )}

          <MessageMedia message={message} onOpenImage={onOpenImage} />

          {message.type === 'call' ? (
            <CallMessageContent message={message} />
          ) : (
            <MessageContentRenderer content={translations[message.id] || message.content} />
          )}

          {message.reactions?.length > 0 && (
            <div className="message-reactions">
              {message.reactions.map((reaction) => (
                <span className={cn(reaction.myReaction && 'bg-accent-2')} key={reaction.emoji}>
                  {reaction.emoji} {reaction.count}
                </span>
              ))}
            </div>
          )}

          <div className="message-meta">
            {message.isEdited && <span>{t('edited', 'изменено')}</span>}
            <time>{formatMessageTime(message.createdAt)}</time>
          </div>
        </div>
        {selectionMode && <MessageCheckbox isChecked={isSelected} className="grow-0 self-end" />}
      </article>
    );
  }
);

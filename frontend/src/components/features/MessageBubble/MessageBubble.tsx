import { MessageCheckbox } from '@/components/ui';
import { useMessageLongPress } from '@/hooks';
import { useThreadMessagesData } from '@/queries/chat/useThreadMessagesData';
import { useChatUiStore } from '@/store';
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
    const setActionMenu = useChatUiStore((state) => state.setActionMenu);
    const actionMenu = useChatUiStore((state) => state.actionMenu);
    const isActionTarget = useChatUiStore((state) => state.actionMenu?.messageId === message.id);
    const selectionMode = useChatUiStore((state) => state.selectionMode);
    const isSelected = useChatUiStore((state) =>
      state.selectedMessages.some(({ id }) => id === message.id)
    );
    // Исходное сообщение ответа ищется в истории чата — она живёт в кеше запросов.
    const threadMessages = useThreadMessagesData();
    const repliedMessage = message.replyTo
      ? threadMessages.find(({ id }) => id === message.replyTo)
      : null;

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

    const actualType = message.mediaType || message.type;
    const isAudio = actualType === 'audio' || actualType === 'voice';

    return (
      <article
        id={message.id}
        className={cn('flex justify-between gap-x-2', mine && 'justify-end')}
        {...longPressHandlers}
      >
        <div
          className={cn(
            'message-bubble',
            mine && 'is-mine',
            hasMessageMedia(message) && 'has-media',
            isAudio && 'has-audio w-full',
            isActionTarget && 'is-action-target',
            isSelected && 'is-selected bg-accent'
          )}
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

          {message.senderVerified === false && (
            <p className="message-unverified">
              {t('senderNotConfirmed', '⚠️ Не удалось подтвердить отправителя')}
            </p>
          )}

          {message.type === 'call' ? (
            <CallMessageContent message={message} />
          ) : message.undecryptable ? (
            /* Подпись к нечитаемому сообщению собирается здесь: причину
               назвал слой шифрования, а язык знает интерфейс. */
            <p className="message-content opacity-70">
              🔒 {t(`undecryptable.${message.undecryptable}`, message.content)}
            </p>
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

import { Button, Icon, Spinner } from '@/shared/ui';
import { useMessageLongPress } from '@/hooks/useMessageLongPress';
import { useChatUiStore } from '@/store';
import type { IMediaItem, IMessageDto } from '../../model/types';
import { cn, formatMessageTime, hasMessageMedia } from '@/shared/lib';
import { memo, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { CallMessageContent } from './CallMessageContent';
import { MessageCheckbox } from './MessageCheckbox';
import { MessageContentRenderer } from './MessageContent';
import { MessageMedia } from './MessageMedia';
import { MessageReplyPreview } from './MessageReplyPreview';

interface Props {
  currentUserId: string;
  message: IMessageDto;
  /**
   * Сообщение, на которое отвечают, — для превью над ответом. Ищет его
   * список: у него лента уже есть, а пузырю нужна одна запись.
   *
   * Прежде пузырь искал сам, через `useThreadMessagesData`, и вместе с
   * этим подписывался на всю историю чата. Подписки на один ключ
   * дедуплицируются, а вот результат `select` — нет: он склеивает и
   * сортирует страницы, и копию этого массива держал каждый наблюдатель.
   * Сто сообщений — сто копий по сто ссылок, и сто сортировок на каждое
   * изменение ленты.
   */
  repliedMessage?: IMediaItem;
  translations: Record<string, string>;
  onOpenImage: Dispatch<SetStateAction<string | null>>;
  onSelection: (message: IMessageDto) => void;
  /**
   * Нажатие по реакции под сообщением. Обработчик приходит сверху, а не
   * берётся хуком здесь: `useMessageActions` тянет за собой запрос чата и
   * подписки, и в каждом пузыре это стоило бы столько же, сколько
   * подписка на всю ленту, от которой избавлялись в #298.
   */
  onReact: (message: IMessageDto, emoji: string) => void;
  /** Переход к цитируемому сообщению по клику на плашку ответа (#553). */
  onJumpToMessage?: (messageId: string) => void;
  /** Повторная отправка сообщения из Outbox при ошибке сети (#552). */
  onRetryMessage?: (message: IMessageDto) => void;
  /** Отмена/удаление неудачного сообщения из Outbox (#552). */
  onCancelMessage?: (message: IMessageDto) => void;
}

export const MessageBubble = memo(
  ({
    currentUserId,
    message,
    repliedMessage,
    translations,
    onOpenImage,
    onReact,
    onSelection,
    onJumpToMessage,
    onRetryMessage,
    onCancelMessage,
  }: Props) => {
    const setActionMenu = useChatUiStore((state) => state.setActionMenu);
    const actionMenu = useChatUiStore((state) => state.actionMenu);
    const isActionTarget = useChatUiStore((state) => state.actionMenu?.messageId === message.id);
    const selectionMode = useChatUiStore((state) => state.selectionMode);
    const isSelected = useChatUiStore((state) =>
      state.selectedMessages.some(({ id }) => id === message.id)
    );
    const isHighlighted = useChatUiStore((state) => state.highlightedMessageId === message.id);
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

    const actualType = message.mediaType || message.type;
    const isAudio = actualType === 'audio' || actualType === 'voice';
    const targetReplyId = message.replyTo || message.replyToMessageId;
    const hasReply = Boolean(targetReplyId || repliedMessage);

    return (
      <article
        id={message.id}
        className={cn('flex justify-between gap-x-2', mine && 'justify-end')}
        {...longPressHandlers}
      >
        <div
          data-state={isSelected ? 'selected' : undefined}
          className={cn(
            'message-bubble',
            mine && 'is-mine',
            hasMessageMedia(message) && 'has-media',
            isAudio && 'w-full',
            isActionTarget && 'is-action-target',
            isSelected &&
              'is-selected data-[state=selected]:bg-brand-soft ring-2 ring-brand ring-offset-2 ring-offset-ground shadow-sm',
            isHighlighted &&
              'ring-2 ring-brand ring-offset-2 ring-offset-ground bg-brand-soft/25 transition-all duration-500'
          )}
        >
          {!mine && message.senderStatusEmoji && (
            <div className="mb-[3px] text-brand text-xs font-semibold">
              <span className="ml-1.5 inline-block">{message.senderStatusEmoji}</span>
            </div>
          )}

          {hasReply && (
            <MessageReplyPreview
              message={message}
              onJumpToMessage={onJumpToMessage}
              repliedMessage={repliedMessage}
            />
          )}

          <MessageMedia message={message} onOpenImage={onOpenImage} />

          {message.senderVerified === false && (
            <p className="mb-1 text-xs text-warn">
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
                /* Нажатие по реакции ставит свою или снимает — как в
                   привычных мессенджерах. Прежде это был `span`, и
                   единственным способом снять реакцию оставалось меню по
                   правой кнопке. */
                <button
                  aria-label={`${reaction.emoji} ${reaction.count}`}
                  aria-pressed={reaction.myReaction}
                  className={cn(reaction.myReaction && 'is-mine')}
                  key={reaction.emoji}
                  onClick={(event) => {
                    // Иначе нажатие уходит выше и открывает меню действий.
                    event.stopPropagation();
                    onReact(message, reaction.emoji);
                  }}
                  type="button"
                >
                  {reaction.emoji} {reaction.count}
                </button>
              ))}
            </div>
          )}

          <div className="message-meta">
            {message.isEdited && <span>{t('edited', 'изменено')}</span>}
            <time>{formatMessageTime(message.createdAt)}</time>
            {mine &&
              (message.status === 'pending' || message.status === 'uploading') && (
                <span
                  className="inline-flex items-center gap-1 text-ink-3"
                  title={
                    message.status === 'uploading'
                      ? t('uploading', 'Загрузка...')
                      : t('sending', 'Отправка...')
                  }
                >
                  <Spinner
                    size="sm"
                    label={
                      message.status === 'uploading'
                        ? t('uploading', 'Загрузка...')
                        : t('sending', 'Отправка...')
                    }
                  />
                </span>
              )}
          </div>

          {mine && message.status === 'failed' && (
            <div className="flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-danger/20 text-danger text-caption">
              <span className="flex items-center gap-1 font-medium">
                <Icon name="warning" size="sm" />
                {t('sendFailed', 'Не удалось отправить')}
              </span>
              <div className="flex items-center gap-1">
                {onRetryMessage && (
                  <Button
                    aria-label={t('retrySend', 'Повторить отправку')}
                    className="text-danger border-danger/30 hover:bg-danger/10 text-micro px-2 py-0.5 h-auto min-h-0"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetryMessage(message);
                    }}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    <Icon name="rotateCw" size="sm" />
                    {t('retry', 'Повторить')}
                  </Button>
                )}
                {onCancelMessage && (
                  <Button
                    aria-label={t('delete', 'Удалить')}
                    className="text-danger border-transparent hover:bg-danger/10 text-micro p-1 h-auto min-h-0"
                    iconOnly
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancelMessage(message);
                    }}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    <Icon name="cross" size="sm" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        {selectionMode && <MessageCheckbox isChecked={isSelected} className="grow-0 self-end" />}
      </article>
    );
  }
);

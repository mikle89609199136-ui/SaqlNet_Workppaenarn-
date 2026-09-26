import { Button, Icon, Spinner } from '@/shared/ui';
import { useMessageLongPress } from '../../model/useMessageLongPress';
import { useChatUiStore } from '@/entities/chat';
import type { IMediaItem, IMessageDto } from '../../model/types';
import { cn } from '@/shared/lib';
import { formatMessageTime, hasMessageMedia } from '../../model/messageUtils';
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
  /** Профиль автора пересланного сообщения по клику на его имя (#785). */
  onOpenProfile?: (userId: string) => void;
  /** Повторная отправка сообщения из Outbox при ошибке сети (#552). */
  onRetryMessage?: (message: IMessageDto) => void;
  /** Отмена/удаление неудачного сообщения из Outbox (#552). */
  onCancelMessage?: (message: IMessageDto) => void;
  /**
   * Показывать ли статус доставки у своих сообщений.
   *
   * Только личные чаты: в группе у «прочитано» нет одного значения —
   * непонятно, прочитал один участник или все, — и галочка начинала бы
   * врать. Спиннер отправки и ошибка показываются в любом чате: это про
   * судьбу моего сообщения, а не про чужие глаза.
   */
  showDeliveryStatus?: boolean;
  /** Первое сообщение в непрерывной цепочке одного автора. */
  isFirstInGroup?: boolean;
  /** Последнее сообщение в группе — рисуется с «хвостиком» (срезанный угол). */
  isLastInGroup?: boolean;
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
    onOpenProfile,
    onRetryMessage,
    onCancelMessage,
    showDeliveryStatus = false,
    isFirstInGroup = true,
    isLastInGroup = true,
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

    const actualType = message.type;
    const isAudio = actualType === 'audio' || actualType === 'voice';
    const targetReplyId = message.replyTo || message.replyToMessageId;
    const hasReply = Boolean(targetReplyId || repliedMessage);
    const hasInlineMeta =
      message.type !== 'call' && (Boolean(message.content) || Boolean(message.undecryptable));

    const renderMeta = (inline = true) => (
      <span
        className={cn(
          'message-meta font-mono text-micro text-ink-3 tabular-nums select-none whitespace-nowrap',
          inline
            ? 'float-right inline-flex items-center gap-1 ml-3 mt-2 leading-none'
            : 'mt-1 flex items-center justify-end gap-1'
        )}
      >
        {message.isPinned && (
          <span
            aria-label={t('pinned', 'Закреплено')}
            className="inline-flex items-center text-ink-3"
            title={t('pinned', 'Закреплено')}
          >
            <Icon className="rotate-45 fill-current" name="pin" size="xs" />
          </span>
        )}
        {message.isEdited && <span>{t('edited', 'изменено')}</span>}
        <time>{formatMessageTime(message.createdAt)}</time>
        {mine && (message.status === 'pending' || message.status === 'uploading') && (
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

        {mine && showDeliveryStatus && message.status === 'sent' && (
          <span className="inline-flex items-center text-ink-3" title={t('sent', 'Отправлено')}>
            <Icon name="check" size="xs" />
          </span>
        )}
      </span>
    );

    return (
      <article
        id={message.id}
        className={cn('flex justify-between gap-x-2', mine && 'justify-end')}
        data-first-in-group={isFirstInGroup ? 'true' : undefined}
        data-last-in-group={isLastInGroup ? 'true' : undefined}
        {...longPressHandlers}
      >
        <div
          data-state={isSelected ? 'selected' : undefined}
          className={cn(
            'message-bubble relative w-fit min-w-20 max-w-[min(76%,560px)] px-3 py-1.5 text-body text-ink shadow-[var(--elev-1)] transition-[box-shadow,filter] duration-fast ease-out rounded-bubble',
            mine
              ? cn(
                  'is-mine self-end bg-bubble-out text-bubble-out-ink mr-2.5 rounded-br-control',
                  !isFirstInGroup && 'rounded-tr-control'
                )
              : cn('bg-bubble-in rounded-bl-control', !isFirstInGroup && 'rounded-tl-control'),
            hasMessageMedia(message) && 'has-media w-fit max-w-[min(384px,calc(100%-20px))]',
            isAudio && 'w-full',
            isActionTarget &&
              'is-action-target z-20 max-md:z-[1201] shadow-[0_0_0_2px_var(--color-brand),var(--elev-3)]',
            isSelected &&
              'is-selected data-[state=selected]:bg-brand-soft ring-2 ring-brand ring-offset-2 ring-offset-ground shadow-sm',
            isHighlighted &&
              'ring-2 ring-brand ring-offset-2 ring-offset-ground bg-brand-soft/25 transition-all duration-500'
          )}
        >
          {!mine && isFirstInGroup && message.senderStatusEmoji && (
            <div className="mb-[3px] text-brand text-xs font-semibold">
              <span className="ml-1.5 inline-block">{message.senderStatusEmoji}</span>
            </div>
          )}

          {/* Имя автора подставляет сервер, проверив доступ к исходному
              сообщению. Пустым оно бывает только у старых пересылок.
              Профиль открывается, только если автор разрешил ссылку на
              себя: иначе сервер не присылает forwardedSenderId (#785). */}
          {message.isForwarded && (
            <p className="mb-1 text-caption text-ink-3">
              {message.forwardedSenderName ? (
                <>
                  {t('forwardedFrom', 'Переслано от')}{' '}
                  {message.forwardedSenderId && onOpenProfile ? (
                    <button
                      className="font-semibold text-brand hover:underline focus-visible:underline"
                      onClick={(event) => {
                        // Клик по пузырю выделяет сообщение — здесь не нужно.
                        event.stopPropagation();
                        onOpenProfile(message.forwardedSenderId!);
                      }}
                      type="button"
                    >
                      {message.forwardedSenderName}
                    </button>
                  ) : (
                    <b className="font-semibold text-ink-2">{message.forwardedSenderName}</b>
                  )}
                </>
              ) : (
                t('forwarded', 'Переслано')
              )}
            </p>
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
            <p className="message-content text-body whitespace-pre-wrap leading-snug [overflow-wrap:anywhere] opacity-70 flow-root">
              🔒 {t(`undecryptable.${message.undecryptable}`, message.content)}
              {renderMeta(true)}
            </p>
          ) : (
            <MessageContentRenderer
              content={translations[message.id] || message.content}
              trailing={hasInlineMeta ? renderMeta(true) : undefined}
            />
          )}

          {message.reactions?.length > 0 && (
            <div className="message-reactions mt-[7px] flex flex-wrap gap-[5px]">
              {message.reactions.map((reaction) => (
                /* Нажатие по реакции ставит свою или снимает — как в
                   привычных мессенджерах. Прежде это был `span`, и
                   единственным способом снять реакцию оставалось меню по
                   правой кнопке. */
                <button
                  aria-label={`${reaction.emoji} ${reaction.count}`}
                  aria-pressed={reaction.myReaction}
                  className={cn(
                    'min-h-[22px] px-[7px] py-0.5 rounded-pill bg-sheet-2 text-[12px] cursor-pointer border border-transparent transition-[background-color,border-color] duration-fast ease-out hover:border-line focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
                    reaction.myReaction && 'is-mine bg-brand-soft'
                  )}
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

          {!hasInlineMeta && renderMeta(false)}

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

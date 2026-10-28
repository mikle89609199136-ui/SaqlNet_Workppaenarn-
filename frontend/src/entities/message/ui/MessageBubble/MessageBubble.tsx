import { Avatar, Icon, NotoEmoji, Tooltip } from '@/shared/ui';
import { useMessageLongPress } from '../../model/useMessageLongPress';
import { getLastMessageText, useChatUiStore } from '@/entities/chat';
import { menuPointNear } from '../../model/messageMenu';
import { useMessageMenuKeys } from '../../model/useMessageMenuKeys';
import type { IMediaItem, IMessageDto, IReaction } from '../../model/types';
import { cn, receiptState } from '@/shared/lib';
import {
  formatEditedAt,
  formatMessageTime,
  forwardedOriginId,
  hasMessageMedia,
} from '../../model/messageUtils';
import { useReactionAuthors } from '../../model/useReactionAuthors';
import { formatReactionAuthorsSummary } from '../../model/reactionAuthorsSummary';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
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
  /**
   * Профиль человека: автора пересланного сообщения (#785) и участника
   * группы — по имени и аватарке над его сообщениями (#820).
   */
  onOpenProfile?: (userId: string) => void;
  /** Повторная отправка сообщения из Outbox при ошибке сети (#552). */
  onRetryMessage?: (message: IMessageDto) => void;
  /** Отмена/удаление неудачного сообщения из Outbox (#552). */
  onCancelMessage?: (message: IMessageDto) => void;
  /** Скачать ещё раз вложение, которое не скачалось (#1062). */
  onRetryMedia?: (message: IMessageDto) => Promise<void> | void;
  /** Перейти к исходному сообщению пересланного — в «Избранном» (#1076). */
  onOpenOriginal?: (messageId: string) => void;
  /**
   * Показывать ли «прочитано» у своих сообщений.
   *
   * Только личные чаты: в группе у «прочитано» нет одного значения —
   * непонятно, прочитал один участник или все, — и двойная галочка
   * начинала бы врать. «Отправляется» и «отправлено» показываются в любом
   * чате: это про судьбу моего сообщения, а не про чужие глаза.
   */
  showDeliveryStatus?: boolean;
  showMessageTime?: boolean;
  showMessageStatus?: boolean;
  showMessageAvatars?: boolean;
  /** Группа: у чужих сообщений — имя автора и его аватарка (#820). */
  isGroupChat?: boolean;
  /** Первое сообщение в непрерывной цепочке одного автора. */
  isFirstInGroup?: boolean;
  /** Последнее сообщение в серии: у него аватарка автора в группе. */
  isLastInGroup?: boolean;
  tabIndex?: number;
  searchQuery?: string;
  isSearchCurrent?: boolean;
}

/* Цвет имени автора — из его идентификатора: соседние реплики разных
   людей различаются с первого взгляда, а у одного человека цвет всегда
   тот же. Готовыми именами классов — иначе Tailwind их не увидит. */
const AUTHOR_INKS = ['text-author-1', 'text-author-2', 'text-author-3', 'text-author-4'] as const;

function authorInk(senderId: string) {
  let sum = 0;
  for (let i = 0; i < senderId.length; i++) sum = (sum + senderId.charCodeAt(i)) % 997;
  return AUTHOR_INKS[sum % AUTHOR_INKS.length];
}

/* Анимированная картинка Noto играет столько, потом — снова статичная. */
const REACTION_PLAY_MS = 2500;

interface IReactionPillProps {
  messageId?: string;
  chatId?: string;
  reactions?: IReaction[];
  emoji: string;
  count: number;
  mine: boolean;
  currentUserId?: string;
  onToggle: () => void;
  onOpenAuthors?: () => void;
}

/**
 * Реакция под пузырём — по макету: картинка Noto 20px и число; своя —
 * на мягкой подложке акцента с обводкой. Когда своя реакция появляется
 * (нажатием здесь или из меню сообщения), отметка «хлопает» и эмодзи
 * проигрывает анимацию.
 * Тултип отображает авторов при наведении (задержка 500 мс) (#998).
 */
function ReactionPill({
  messageId = '',
  chatId,
  reactions,
  emoji,
  count,
  mine,
  currentUserId,
  onToggle,
  onOpenAuthors,
}: IReactionPillProps) {
  const [wasMine, setWasMine] = useState(mine);
  const [playing, setPlaying] = useState(false);
  const [shouldFetch, setShouldFetch] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useTranslation();
  const setReactionAuthorsModal = useChatUiStore((state) => state.setReactionAuthorsModal);

  // Появление своей реакции ловится при отрисовке: так анимация стартует
  // в том же кадре, что и смена подложки.
  if (mine !== wasMine) {
    setWasMine(mine);
    if (mine) setPlaying(true);
  }

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setTimeout(() => setPlaying(false), REACTION_PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing]);

  const startHoverTimer = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    // Задержка 500 мс для защиты от hover thrashing при скролле
    hoverTimerRef.current = setTimeout(() => {
      setShouldFetch(true);
    }, 500);
  };

  const cancelHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const isOnlyMine = count === 1 && mine;
  const isQueryEnabled = shouldFetch && !isOnlyMine && Boolean(messageId);

  const { authors, isLoading, isError } = useReactionAuthors({
    messageId,
    emoji,
    enabled: isQueryEnabled,
  });

  const tooltipText = useMemo(() => {
    if (isOnlyMine) {
      return t('reactions.you', 'Вы');
    }
    if (!shouldFetch && !authors.length) {
      return '';
    }
    if (isError) return t('reactions.loadError', 'Не удалось загрузить авторов');
    if (isLoading && !authors.length) {
      return t('loading', 'Загрузка...');
    }
    return formatReactionAuthorsSummary({
      authors,
      total: count,
      mine,
      currentUserId,
      t,
    });
  }, [isOnlyMine, shouldFetch, authors, isLoading, isError, count, mine, currentUserId, t]);

  const handleOpenAuthors = () => {
    if (onOpenAuthors) {
      onOpenAuthors();
    } else if (messageId) {
      setReactionAuthorsModal({
        messageId,
        chatId,
        initialEmoji: emoji,
        reactions,
      });
    }
  };

  const pill = (
    <button
      aria-label={`${emoji} ${count}`}
      aria-pressed={mine}
      className={cn(
        'flex h-7 cursor-pointer items-center gap-1.25 rounded-pill pr-2.25 pl-1.5 text-caption font-semibold',
        'transition-colors duration-fast hover:layer-hover',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
        mine
          ? 'is-mine bg-brand-soft text-brand shadow-[inset_0_0_0_1px_var(--color-brand)]'
          : 'bg-sheet-2 text-ink-2'
      )}
      onClick={(event) => {
        // Иначе нажатие уходит выше и открывает меню действий.
        event.stopPropagation();
        onToggle();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        handleOpenAuthors();
      }}
      onMouseEnter={startHoverTimer}
      onMouseLeave={cancelHoverTimer}
      onFocus={startHoverTimer}
      onBlur={cancelHoverTimer}
      type="button"
    >
      <NotoEmoji
        animated={playing}
        className={cn(
          playing && 'animate-[rx-pop_420ms_cubic-bezier(.2,1.6,.4,1)] motion-reduce:animate-none'
        )}
        emoji={emoji}
        size={20}
      />
      {count}
    </button>
  );

  if (!tooltipText) {
    return pill;
  }

  return (
    <Tooltip content={tooltipText} position="top">
      {pill}
    </Tooltip>
  );
}

/**
 * Пузырь сообщения — по дизайн-системе (Bubble) и доске «Чат» (#820).
 *
 * Чужое — на bubble-in, своё — на заливке акцента, белым. Серия (подряд
 * одного автора) сглаживает угол со стороны автора у всех, кроме первого:
 * снизу он срезан у каждого, сверху — у продолжений. В группе у чужих над
 * первым сообщением серии — имя автора, у последнего слева — аватарка;
 * по ним открывается профиль. Реакции и ошибка отправки — под пузырём.
 */
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
    onRetryMedia,
    onOpenOriginal,
    showDeliveryStatus = false,
    showMessageTime = true,
    showMessageStatus = true,
    showMessageAvatars = true,
    isGroupChat = false,
    isFirstInGroup = true,
    isLastInGroup = true,
    tabIndex,
    searchQuery,
    isSearchCurrent = false,
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
    const handleMenuKeys = useMessageMenuKeys({
      message,
      selectionMode,
      onSelection,
      setActionMenu,
    });

    const actualType = message.type;
    const isAudio = actualType === 'audio' || actualType === 'voice';
    const isVoice = (message.mediaType || actualType) === 'voice';
    const isCall = message.type === 'call';
    const targetReplyId = message.replyTo || message.replyToMessageId;
    const hasReply = Boolean(targetReplyId || repliedMessage);
    const hasInlineMeta =
      !isCall && !isVoice && (Boolean(message.content) || Boolean(message.undecryptable));

    const groupIn = isGroupChat && !mine;
    const authorName = message.senderName || message.senderFirstName;
    const showAuthor = groupIn && isFirstInGroup && Boolean(authorName);
    const failed = mine && message.status === 'failed';

    /* Статус своего сообщения (#657): часы — пока уходит, одна галочка —
       отправлено, две приглушённые — доставлено, две цветные — прочитано.
       Доставку и прочтение сообщает сервер; показываются они только в
       личном чате — в группе у них нет одного значения. */
    const sending = message.status === 'pending' || message.status === 'uploading';
    const delivery: 'sending' | 'sent' | 'delivered' | 'read' | null =
      !mine || !showMessageStatus
        ? null
        : sending
          ? 'sending'
          : failed
            ? null
            : showDeliveryStatus
              ? receiptState(message)
              : 'sent';
    const deliveryLabel = {
      sending:
        message.status === 'uploading'
          ? t('uploading', 'Загрузка...')
          : t('sending', 'Отправка...'),
      sent: t('messageStatus.sent', 'Отправлено'),
      delivered: t('messageStatus.delivered', 'Доставлено'),
      read: t('messageStatus.read', 'Прочитано'),
    };

    // Когда поправили (#1066): подсказкой у «изменено» и в подписи для диктора.
    const editedAt = formatEditedAt(message, t);
    const originId = forwardedOriginId(message);
    const announcement = [
      mine ? t('you', 'Вы') : authorName,
      // Звонок getLastMessageText подписывает сам («Входящий звонок · 28 сек»),
      // а не читает служебный JSON из content.
      getLastMessageText({ ...message, type: isVoice ? 'voice' : actualType }, t, currentUserId),
      showMessageTime && formatMessageTime(message.createdAt),
      editedAt,
      delivery && deliveryLabel[delivery],
    ]
      .filter(Boolean)
      .join(', ');

    /* Мета — булавка, «изменено», время, статус. Своё — чистым белым:
       полупрозрачный на части акцентов не держит контраст. */
    const metaClass = cn(
      'message-meta ml-2.5 items-center gap-0.75 text-micro whitespace-nowrap tabular-nums select-none',
      mine ? 'text-out-meta' : 'text-ink-3'
    );
    const metaContent = (
      <>
        {message.isPinned && (
          <span aria-label={t('pinned', 'Закреплено')} className="flex" role="img">
            <Icon className="size-3 stroke-2" name="pin" />
          </span>
        )}
        {message.isEdited && <span title={editedAt ?? undefined}>{t('edited', 'изменено')}</span>}
        {showMessageTime && <time>{formatMessageTime(message.createdAt)}</time>}
        {delivery && (
          <span
            aria-label={deliveryLabel[delivery]}
            className="flex data-[delivery=delivered]:text-out-tick data-[delivery=read]:text-out-read data-[delivery=sent]:text-out-tick"
            data-delivery={delivery}
            role="img"
          >
            <Icon
              className="size-4 stroke-2"
              name={
                delivery === 'sending'
                  ? 'clock'
                  : delivery === 'delivered' || delivery === 'read'
                    ? 'checkCheck'
                    : 'check'
              }
            />
          </span>
        )}
      </>
    );
    /* В звонке, голосовом и под медиа — строкой рядом с содержимым. */
    const hasMeta = message.isPinned || message.isEdited || showMessageTime || Boolean(delivery);
    const meta = hasMeta ? (
      <span className={cn(metaClass, 'inline-flex align-[-2px]')}>{metaContent}</span>
    ) : undefined;
    /* В тексте — всегда в правом нижнем углу: прижата вправо в конце
       текста. Помещается на последней строке — встаёт на неё справа, нет —
       переносится ниже, тоже справа. */
    const cornerMeta = hasMeta ? (
      <span className={cn(metaClass, 'float-right mt-1 flex')}>{metaContent}</span>
    ) : undefined;

    return (
      <article
        aria-label={announcement}
        id={message.id}
        className="group/message flex flex-col outline-none"
        data-first-in-group={isFirstInGroup ? 'true' : undefined}
        data-last-in-group={isLastInGroup ? 'true' : undefined}
        onKeyDown={handleMenuKeys}
        tabIndex={tabIndex}
        {...longPressHandlers}
      >
        <div className="flex items-center gap-2.5">
          {selectionMode && <MessageCheckbox isChecked={isSelected} />}

          {/* Место под аватарку есть у каждого чужого сообщения группы, а
              сама она — у последнего в серии: столбец пузырей не ломается. */}
          {groupIn && showMessageAvatars && (
            <span className={cn('flex shrink-0 self-end', !isLastInGroup && 'invisible')}>
              {onOpenProfile && isLastInGroup ? (
                <button
                  aria-label={`${t('profileOf', 'Профиль')}: ${authorName}`}
                  className="rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenProfile(message.senderId);
                  }}
                  tabIndex={-1}
                  type="button"
                >
                  <Avatar
                    id={message.senderId}
                    name={authorName}
                    size="sm"
                    src={message.senderAvatar}
                  />
                </button>
              ) : (
                <Avatar
                  id={message.senderId}
                  name={authorName}
                  size="sm"
                  src={message.senderAvatar}
                />
              )}
            </span>
          )}

          <div
            data-mine={mine ? 'true' : undefined}
            data-state={isSelected ? 'selected' : undefined}
            className={cn(
              'group/bubble message-bubble relative w-fit min-w-0 max-w-[min(280px,100%)] md:max-w-[380px] lg:max-w-[440px] xl:max-w-[520px]',
              'px-3 py-(--chat-bubble-py) text-body leading-[1.45] transition-shadow duration-[160ms]',
              /* Цвет «пыли» закрытого спойлера: текст пузыря с прозрачностью,
                 на своём — белый. */
              mine
                ? '[--dust:var(--color-on-brand)]'
                : '[--dust:color-mix(in_srgb,var(--color-ink)_80%,transparent)]',
              'rounded-bubble',
              mine
                ? cn(
                    'is-mine ml-auto bg-brand-fill text-on-brand rounded-br-control',
                    !isFirstInGroup && 'rounded-tr-control'
                  )
                : cn(
                    'bg-bubble-in text-ink rounded-bl-control',
                    !isFirstInGroup && 'rounded-tl-control'
                  ),
              isCall && 'py-[calc(var(--chat-bubble-py)+2px)] pr-3.5 pl-2.5',
              isVoice && 'pr-3 pl-2',
              message.undecryptable && 'px-3.5 py-[calc(var(--chat-bubble-py)+2px)]',
              hasMessageMedia(message) && 'has-media',
              /* Плееру аудиофайла нужна ширина под ползунок. Голосовое — по
                 содержимому (кнопка, волна, время), в пределах максимума. */
              isAudio && !isVoice && 'w-full',
              /* Выбранное и то, над которым открыто меню, — обводкой через
                 зазор цвета ленты, как в макете. */
              (isSelected || isActionTarget) &&
                'shadow-[0_0_0_2px_var(--color-chat-bg),0_0_0_4px_var(--color-brand)]',
              'group-focus-visible/message:shadow-[0_0_0_2px_var(--color-chat-bg),0_0_0_4px_var(--color-brand)]',
              isActionTarget && 'is-action-target z-20 max-md:z-[1201]',
              isSelected && 'is-selected',
              /* Переход к сообщению — вспышкой, как в макете. */
              isHighlighted && 'msg-flash motion-reduce:animate-none'
            )}
          >
            {isHighlighted && (
              <span
                aria-hidden="true"
                className="msg-overlay pointer-events-none absolute inset-0 z-10 rounded-[inherit] bg-brand/20 motion-reduce:animate-none"
              />
            )}
            {showAuthor && (
              <div className="mb-0.5 flex items-center gap-1.5">
                {onOpenProfile ? (
                  <button
                    className={cn(
                      'block text-left text-caption font-semibold hover:underline focus-visible:underline',
                      authorInk(message.senderId)
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenProfile(message.senderId);
                    }}
                    type="button"
                  >
                    {authorName}
                  </button>
                ) : (
                  <span className={cn('text-caption font-semibold', authorInk(message.senderId))}>
                    {authorName}
                  </span>
                )}
                {message.senderStatusEmoji && (
                  <span className="text-caption">{message.senderStatusEmoji}</span>
                )}
              </div>
            )}

            {/* Имя автора подставляет сервер, проверив доступ к исходному
                сообщению. Пустым оно бывает только у старых пересылок.
                Профиль открывается, только если автор разрешил ссылку на
                себя: иначе сервер не присылает forwardedSenderId (#785). */}
            {/* В «Избранном» строка целиком ведёт к оригиналу (#1076), как
                цитата ответа; имя автора тогда простым текстом — его профиль
                откроется из исходного чата. */}
            {message.isForwarded && onOpenOriginal && originId ? (
              <button
                aria-label={t('savedMessages.goToOriginal', 'Перейти к исходному сообщению')}
                className={cn(
                  'mb-0.5 block text-left text-caption hover:underline focus-visible:underline',
                  mine ? 'text-out-meta' : 'text-brand'
                )}
                onClick={(event) => {
                  // Клик по пузырю выделяет сообщение — здесь не нужно.
                  event.stopPropagation();
                  onOpenOriginal(originId);
                }}
                type="button"
              >
                {message.forwardedSenderName ? (
                  <>
                    {t('forwardedFrom', 'Переслано от')}{' '}
                    <b className="font-semibold">{message.forwardedSenderName}</b>
                  </>
                ) : (
                  t('forwarded', 'Переслано')
                )}
              </button>
            ) : (
              message.isForwarded && (
                <p className={cn('mb-0.5 text-caption', mine ? 'text-out-meta' : 'text-brand')}>
                  {message.forwardedSenderName ? (
                    <>
                      {t('forwardedFrom', 'Переслано от')}{' '}
                      {message.forwardedSenderId && onOpenProfile ? (
                        <button
                          className="font-semibold hover:underline focus-visible:underline"
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
                        <b className="font-semibold">{message.forwardedSenderName}</b>
                      )}
                    </>
                  ) : (
                    t('forwarded', 'Переслано')
                  )}
                </p>
              )
            )}

            {hasReply && (
              <MessageReplyPreview
                message={message}
                mine={mine}
                onJumpToMessage={onJumpToMessage}
                repliedMessage={repliedMessage}
              />
            )}

            <MessageMedia
              message={message}
              onOpenImage={onOpenImage}
              onRetryMedia={onRetryMedia}
              trailing={isVoice ? meta : undefined}
            />

            {message.senderVerified === false && (
              <p className={cn('mb-1 text-meta', mine ? 'text-out-meta' : 'text-warn')}>
                {t('senderNotConfirmed', '⚠️ Не удалось подтвердить отправителя')}
              </p>
            )}

            {isCall ? (
              <CallMessageContent currentUserId={currentUserId} message={message} trailing={meta} />
            ) : message.undecryptable ? (
              /* Подпись к нечитаемому сообщению собирается здесь: причину
                 назвал слой шифрования, а язык знает интерфейс. */
              <p
                className={cn(
                  'flex items-center gap-2 text-ui italic',
                  mine ? 'text-out-meta' : 'text-ink-3'
                )}
              >
                <Icon className="size-4.5 shrink-0" name="lock" />
                <span className="flow-root min-w-0 [overflow-wrap:anywhere]">
                  {t(`undecryptable.${message.undecryptable}`, message.content)}
                  <span className="not-italic">{cornerMeta}</span>
                </span>
              </p>
            ) : (
              <MessageContentRenderer
                content={translations[message.id] || message.content}
                // У перевода свой текст и свои смещения: форматирование оригинала
                // к нему не приложить.
                entities={translations[message.id] ? undefined : message.entities}
                highlight={
                  searchQuery ? { query: searchQuery, current: isSearchCurrent } : undefined
                }
                trailing={hasInlineMeta ? cornerMeta : undefined}
              />
            )}

            {hasMeta && !hasInlineMeta && !isCall && !isVoice && (
              <div className="mt-1 flex justify-end">{meta}</div>
            )}

            {!selectionMode && (
              <button
                aria-haspopup="menu"
                aria-label={t('messageActions.title', 'Действия с сообщением')}
                className={cn(
                  'absolute top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-pill bg-sheet-2 text-ink-2 shadow-[var(--elev-1)] max-md:hidden',
                  'pointer-events-none opacity-0 transition-opacity duration-fast',
                  'group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-visible/message:opacity-100',
                  'hover:text-ink focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-brand',
                  mine ? 'right-full mr-1.5' : 'left-full ml-1.5'
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  setActionMenu({ messageId: message.id, ...menuPointNear(event.currentTarget) });
                }}
                tabIndex={-1}
                type="button"
              >
                <Icon className="size-4.5" name="more" />
              </button>
            )}
          </div>
        </div>

        {failed && (
          <div className="mt-1 flex items-center justify-end gap-3 text-meta">
            <span className="flex items-center gap-1 text-danger">
              <Icon className="size-3.5" name="warning" />
              {t('notSent', 'Не отправлено')}
            </span>
            {onRetryMessage && (
              <button
                aria-label={t('retrySend', 'Повторить отправку')}
                className="font-semibold text-brand hover:underline focus-visible:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetryMessage(message);
                }}
                type="button"
              >
                {t('retry', 'Повторить')}
              </button>
            )}
            {onCancelMessage && (
              <button
                className="text-ink-3 hover:underline focus-visible:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  onCancelMessage(message);
                }}
                type="button"
              >
                {t('delete', 'Удалить')}
              </button>
            )}
          </div>
        )}

        {message.reactions?.length > 0 && (
          <div
            className={cn(
              'message-reactions mt-0.5 flex flex-wrap gap-1.5',
              mine && 'justify-end',
              /* Под пузырём, а не под аватаркой и флажком выбора. */
              groupIn && showMessageAvatars && (selectionMode ? 'pl-[74px]' : 'pl-10.5'),
              (!groupIn || !showMessageAvatars) && !mine && selectionMode && 'pl-8'
            )}
          >
            {message.reactions.map((reaction) => (
              <ReactionPill
                chatId={message.chatId}
                count={reaction.count}
                currentUserId={currentUserId}
                emoji={reaction.emoji}
                key={reaction.emoji}
                messageId={message.id}
                mine={reaction.myReaction}
                onToggle={() => onReact(message, reaction.emoji)}
                reactions={message.reactions}
              />
            ))}
          </div>
        )}
      </article>
    );
  }
);

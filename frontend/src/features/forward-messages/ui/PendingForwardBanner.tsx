import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { IMediaItem, IMessageDto, TMediaMessageType } from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { Icon } from '@/shared/ui';
import type { IPendingForward } from '../model/forwardStore';

interface Props {
  forward: IPendingForward;
  onCancel: () => void;
}

/** Сколько миниатюр показывать: больше не помещается в плашку. */
const MAX_THUMBS = 3;

function mediaKindOf(message: IMessageDto): TMediaMessageType | null {
  const item = message as IMediaItem;
  const kind =
    item.mediaType ??
    (message.metadata as { mediaType?: TMediaMessageType } | undefined)?.mediaType ??
    (message.type !== 'text' && message.type !== 'call' ? message.type : null);
  return (kind as TMediaMessageType | null) ?? null;
}

function mediaLabel(kind: TMediaMessageType | null, t: TFunction): string {
  switch (kind) {
    case 'image':
      return t('lastMessage.image', 'Фотография');
    case 'video':
      return t('lastMessage.video', 'Видео');
    case 'voice':
      return t('lastMessage.voice', 'Голосовое сообщение');
    case 'audio':
      return t('lastMessage.audio', 'Аудио');
    case 'file':
      return t('lastMessage.file', 'Файл');
    case 'sticker':
      return t('lastMessage.sticker', 'Стикер');
    case 'gif':
      return t('lastMessage.gif', 'Гиф');
    default:
      return '';
  }
}

/** Миниатюра вложения — как в превью ответа. */
function Thumb({ message }: { message: IMessageDto }) {
  const kind = mediaKindOf(message);
  const url = (message as IMediaItem).mediaUrl;
  const frame = 'size-9 shrink-0 rounded-control';

  if ((kind === 'image' || kind === 'gif' || kind === 'sticker') && url) {
    return <img alt="" className={`${frame} bg-black/10 object-cover`} src={url} />;
  }
  if (kind === 'video') {
    return (
      <span className={`${frame} flex items-center justify-center bg-black/40 text-white`}>
        <Icon className="ml-0.5 size-4 fill-white" name="play" />
      </span>
    );
  }
  if (kind === 'audio' || kind === 'voice') {
    return (
      <span className={`${frame} flex items-center justify-center bg-brand-soft text-brand`}>
        <Icon className="size-4" name="volume" />
      </span>
    );
  }
  if (kind === 'file') {
    return (
      <span className={`${frame} flex items-center justify-center bg-sheet-2 text-ink-2`}>
        <Icon className="size-4" name="file" />
      </span>
    );
  }
  return null;
}

/**
 * Плашка над полем ввода: что будет переслано (#93).
 *
 * Та же форма, что у ответа и редактирования: человек видит, что и куда
 * уйдёт, может дописать комментарий или передумать. Вложения видны
 * миниатюрами, как в превью ответа: пересылаемая фотография без подписи
 * иначе выглядела бы пустой строкой.
 */
export function PendingForwardBanner({ forward, onCancel }: Props) {
  const { t } = useTranslation();
  const currentUserId = useProfileStore((state) => state.user?.id);
  const { messages } = forward;
  const withMedia = messages.filter((message) => mediaKindOf(message) !== null);

  const authors = [
    ...new Set(
      messages
        .map((message) =>
          message.senderId === currentUserId && !message.forwardedSenderName
            ? t('you', 'Вы')
            : message.forwardedSenderName || message.senderName
        )
        .filter(Boolean)
    ),
  ];

  let details: string;
  if (messages.length === 1) {
    const [only] = messages;
    const text = String(only.content ?? '').trim();
    const label = mediaLabel(mediaKindOf(only), t);
    details = text && label ? `${label}: ${text}` : text || label;
  } else {
    details = authors.join(', ');
  }

  return (
    <div className="thread-composer-context">
      <Icon className="shrink-0 text-brand" name="forward" size="sm" />
      {withMedia.slice(0, MAX_THUMBS).map((message) => (
        <Thumb key={message.id} message={message} />
      ))}
      {withMedia.length > MAX_THUMBS && (
        <span className="shrink-0 text-caption text-ink-2">+{withMedia.length - MAX_THUMBS}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <strong className="truncate font-semibold">
          {messages.length === 1
            ? t('forward.bannerOne', 'Переслать сообщение')
            : t('forward.bannerMany', {
                defaultValue: 'Переслать сообщения: {{count}}',
                count: messages.length,
              })}
        </strong>
        {details && <span className="truncate text-ink-2">{details}</span>}
      </span>

      <button
        aria-label={t('forward.cancel', 'Отменить пересылку')}
        className="thread-composer-close-btn"
        onClick={onCancel}
        type="button"
      >
        <Icon name="cross" size="sm" />
      </button>
    </div>
  );
}

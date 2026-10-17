import { AudioPlayer, Icon, VideoPlayer } from '@/shared/ui';
import type { IMessageDto, TMediaUnavailableReason } from '../../model/types';
import { formatFileSize } from '@/shared/lib';
import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface Props {
  message: IMessageDto;
  onOpenImage: Dispatch<SetStateAction<string | null>>;
  /** Время и статус: у голосового они стоят под его длительностью. */
  trailing?: ReactNode;
  /** Скачать вложение ещё раз, если оно не скачалось (#1062). */
  onRetryMedia?: (message: IMessageDto) => Promise<void> | void;
}

/* Причину называет сервис кодом, подпись — здесь, на языке интерфейса. */
function unavailableText(reason: TMediaUnavailableReason | undefined, t: TFunction): string {
  switch (reason) {
    case 'foreign':
      return t('mediaUnavailable.foreign', 'Медиа недоступно: файл не из этого приложения');
    case 'decryptFailed':
      return t('mediaUnavailable.decryptFailed', 'Медиа недоступно: ошибка расшифровки');
    case 'downloadFailed':
      return t('mediaUnavailable.downloadFailed', 'Не удалось загрузить медиа');
    case 'notFound':
      return t('mediaUnavailable.notFound', 'Медиа недоступно: файла нет на сервере');
    case 'forbidden':
      return t('mediaUnavailable.forbidden', 'Медиа недоступно: нет доступа к файлу');
    default:
      return t('mediaUnavailableUnencrypted', 'Медиа недоступно: файл не зашифрован');
  }
}

export const MessageMedia = ({ message, onOpenImage, trailing, onRetryMedia }: Props) => {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  const { mediaUnavailable, mediaUnavailableReason, mediaUrl, mediaType, type, mediaEncryption } =
    message;

  if (mediaUnavailable) {
    // Повторять имеет смысл только скачивание: файла нет, доступа нет или
    // он не расшифровался — второй раз выйдет то же самое.
    const canRetry = mediaUnavailableReason === 'downloadFailed' && onRetryMedia;

    return (
      <div className="message-media-unavailable">
        {unavailableText(mediaUnavailableReason, t)}
        {canRetry && (
          <button
            aria-label={t('retryMediaDownload', 'Загрузить медиа ещё раз')}
            className="ml-2 font-semibold text-brand hover:underline focus-visible:underline disabled:opacity-60 group-data-[mine]/bubble:text-on-brand"
            disabled={retrying}
            onClick={(event) => {
              // Иначе нажатие откроет меню сообщения.
              event.stopPropagation();
              setRetrying(true);
              void Promise.resolve(onRetryMedia(message)).finally(() => setRetrying(false));
            }}
            type="button"
          >
            {t('retry', 'Повторить')}
          </button>
        )}
      </div>
    );
  }

  if (!mediaUrl) return null;

  const actualType = mediaType || type;

  if (['image', 'gif', 'sticker'].includes(actualType)) {
    return (
      <button
        aria-label={t('openImage', 'Открыть изображение')}
        className="message-media-open"
        onClick={() => onOpenImage(mediaUrl)}
        type="button"
      >
        <img alt="" className={`message-media message-media-${actualType}`} src={mediaUrl} />
      </button>
    );
  }

  if (['video', 'audio'].includes(actualType) || actualType === 'voice') {
    if (actualType === 'video') {
      return (
        <div className="mt-1 mb-2 w-full max-w-sm">
          <VideoPlayer src={mediaUrl} />
        </div>
      );
    }

    return (
      <div className={actualType === 'voice' ? undefined : 'mt-1 mb-2 w-full'}>
        <AudioPlayer
          durationMs={actualType === 'voice' ? message.voice?.durationMs : undefined}
          gainDb={actualType === 'voice' ? message.voice?.gainDb : undefined}
          seed={message.id}
          src={mediaUrl}
          waveform={actualType === 'voice' ? message.voice?.waveform : undefined}
          trailing={actualType === 'voice' ? trailing : undefined}
          variant={actualType === 'voice' ? 'voice' : 'audio'}
        />
      </div>
    );
  }

  if (actualType === 'file') {
    const meta = message.metadata && 'fileName' in message.metadata ? message.metadata : undefined;
    const fileName =
      mediaEncryption?.fileName ?? meta?.fileName ?? message.content ?? t('file', 'Файл');
    const sizeBytes = mediaEncryption?.sizeBytes ?? meta?.sizeBytes;

    return (
      <a
        className="message-media-file mb-1 flex items-center gap-2.5 no-underline"
        download={fileName}
        href={mediaUrl}
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-field bg-brand-soft text-brand group-data-[mine]/bubble:bg-on-brand/16 group-data-[mine]/bubble:text-on-brand"
        >
          <Icon className="size-5" name="file" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-semibold">{fileName}</span>
          {typeof sizeBytes === 'number' && (
            <span className="text-meta text-ink-3 group-data-[mine]/bubble:text-out-meta">
              {formatFileSize(sizeBytes)}
            </span>
          )}
        </div>
      </a>
    );
  }

  return null;
};

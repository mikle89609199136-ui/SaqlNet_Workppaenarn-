import type { IMediaItem, IMessageDto } from '@/types';
import { useTranslation } from 'react-i18next';

interface Props {
  sharedMedia: IMediaItem[];
}

/**
 * Годится ли сообщение в плитку общих медиафайлов.
 *
 * Смотреть надо на `mediaUrl` самого сообщения, а не на
 * `metadata.mediaUrl`. Это разные адреса: в метаданных лежит эндпойнт,
 * отдающий шифровку в JSON, и в `<img src>` он даёт битую картинку.
 * Пригодный для показа адрес появляется после расшифровки —
 * `MessageService.resolveMediaForDisplay` кладёт `blob:` в `mediaUrl`.
 *
 * Там же незашифрованные вложения помечаются `mediaUnavailable`: их не
 * показывает и лента, значит и здесь им делать нечего.
 */
export function isDisplayableMedia(message: IMessageDto): message is IMediaItem {
  if (message.type !== 'image' && message.type !== 'video') return false;

  const item: IMediaItem = message;
  return typeof item.mediaUrl === 'string' && item.mediaUrl.length > 0 && !item.mediaUnavailable;
}

export function ProfileSharedMedia({ sharedMedia }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-title text-ink font-semibold">{t('sharedMedia', 'Общие медиафайлы')}</h4>
      {sharedMedia.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {sharedMedia.map((message) => {
            const mediaUrl = message.mediaUrl;
            if (!mediaUrl) return null;

            const isVideo = message.type === 'video';

            return (
              <a
                className="relative block aspect-square overflow-hidden rounded-control bg-sheet-2 group border border-line"
                href={mediaUrl}
                key={message.id}
                rel="noreferrer"
                target="_blank"
              >
                {isVideo ? (
                  <video
                    className="w-full h-full object-cover"
                    muted
                    preload="metadata"
                    src={mediaUrl}
                  />
                ) : (
                  <img
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    src={mediaUrl}
                  />
                )}
                {isVideo && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 m-auto flex items-center justify-center w-8 h-8 rounded-full bg-black/60 text-white text-caption"
                  >
                    ▶
                  </span>
                )}
              </a>
            );
          })}
        </div>
      ) : (
        <div className="py-6 px-3 bg-sheet-2 border border-line rounded-field text-center text-caption text-ink-3">
          {t('profileMediaEmpty', 'Медиафайлы отсутствуют')}
        </div>
      )}
    </div>
  );
}

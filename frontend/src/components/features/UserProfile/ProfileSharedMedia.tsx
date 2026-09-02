import { Modal } from '@/components/ui';
import { VideoPlayer } from '@/components/features/VideoPlayer';
import type { IMediaItem, IMessageDto } from '@/types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface IOpenedMedia {
  url: string;
  isVideo: boolean;
}

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
  const [openedMedia, setOpenedMedia] = useState<IOpenedMedia | null>(null);

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
              <button
                aria-label={isVideo ? t('videoMessage', 'Видео') : t('imageMessage', 'Изображение')}
                className="relative block aspect-square overflow-hidden rounded-control bg-sheet-2 group border border-line"
                key={message.id}
                onClick={() => setOpenedMedia({ url: mediaUrl, isVideo })}
                type="button"
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
              </button>
            );
          })}
        </div>
      ) : (
        <div className="py-6 px-3 bg-sheet-2 border border-line rounded-field text-center text-caption text-ink-3">
          {t('profileMediaEmpty', 'Медиафайлы отсутствуют')}
        </div>
      )}

      {/* Окно берётся из набора: оно на `<dialog>`, то есть Escape,
          ловушка фокуса и возврат фокуса уже сделаны браузером. Прежде
          плитка вела на `blob:`-адрес в соседней вкладке — там нет ни
          названия, ни возврата в переписку, только голый файл. */}
      {openedMedia && (
        <Modal
          className="w-[min(90vw,900px)] border-0 bg-transparent p-0 shadow-none"
          label={t('imageViewer', 'Просмотр изображения')}
          onClose={() => setOpenedMedia(null)}
        >
          {openedMedia.isVideo ? (
            <VideoPlayer src={openedMedia.url} />
          ) : (
            <img
              alt=""
              className="w-full max-h-[80vh] rounded-window object-contain"
              src={openedMedia.url}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

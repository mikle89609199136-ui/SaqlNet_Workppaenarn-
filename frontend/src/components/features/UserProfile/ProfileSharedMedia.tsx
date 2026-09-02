import type { IMessageDto } from '@/types';
import { useTranslation } from 'react-i18next';

interface Props {
  sharedMedia: IMessageDto[];
}

export function ProfileSharedMedia({ sharedMedia }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-title text-ink font-semibold">{t('sharedMedia', 'Общие медиафайлы')}</h4>
      {sharedMedia.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {sharedMedia.map((message) => {
            const isVideo = message.type === 'video';
            const id = message.id;
            const mediaUrl =
              message.metadata && 'mediaUrl' in message.metadata && typeof message.metadata.mediaUrl === 'string'
                ? message.metadata.mediaUrl
                : '';

            if (!mediaUrl) return null;

            return (
              <a
                className="relative block aspect-square overflow-hidden rounded-control bg-sheet-2 group border border-line"
                href={mediaUrl}
                key={id}
                rel="noreferrer"
                target="_blank"
              >
                {isVideo ? (
                  <video className="w-full h-full object-cover" muted preload="metadata" src={mediaUrl} />
                ) : (
                  <img alt="" className="w-full h-full object-cover" loading="lazy" src={mediaUrl} />
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

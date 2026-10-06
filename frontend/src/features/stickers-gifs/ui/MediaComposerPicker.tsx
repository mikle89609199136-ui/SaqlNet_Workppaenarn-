import { forwardRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { IGif, ISticker } from '@/entities/media';
import { cn } from '@/shared/lib';
import { Button, EmojiPicker, Icon } from '@/shared/ui';
import type { TIconTypes } from '@/types';
import { GifPicker } from './GifPicker';
import { StickerPicker } from './StickerPicker';

export type TMediaPickerTab = 'emoji' | 'stickers' | 'gif';

interface ITabConfig {
  key: TMediaPickerTab;
  labelKey: string;
  defaultLabel: string;
  icon: TIconTypes;
}

const TABS: readonly ITabConfig[] = [
  { key: 'emoji', labelKey: 'mediaPicker.emoji', defaultLabel: 'Эмодзи', icon: 'smile' },
  { key: 'stickers', labelKey: 'mediaPicker.stickers', defaultLabel: 'Стикеры', icon: 'sticker' },
  { key: 'gif', labelKey: 'mediaPicker.gif', defaultLabel: 'GIF', icon: 'image' },
] as const;

interface Props {
  id?: string;
  onPickEmoji: (emoji: string) => void;
  onPickSticker: (sticker: ISticker) => void;
  onPickGif: (gif: IGif) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
  initialTab?: TMediaPickerTab;
}

export const MediaComposerPicker = forwardRef<HTMLDivElement, Props>(
  function MediaComposerPicker(
    {
      id,
      onPickEmoji,
      onPickSticker,
      onPickGif,
      onKeyDown,
      className,
      initialTab = 'emoji',
    },
    ref
  ) {
    const { t } = useTranslation();
    const [tab, setTab] = useState<TMediaPickerTab>(initialTab);

    return (
      <div
        aria-label={t('mediaPicker.title', 'Медиа')}
        className={cn(
          'flex h-105 max-h-[85vh] flex-col gap-2 rounded-dialog border border-divider bg-menu p-2.5 shadow-[var(--shadow-menu)]',
          className
        )}
        id={id}
        onKeyDown={onKeyDown}
        ref={ref}
        role="dialog"
        tabIndex={-1}
      >
        {/* Контент активной вкладки с фиксированной высотой */}
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {tab === 'emoji' && (
            <EmojiPicker
              className="h-full min-h-0 rounded-none border-0 bg-transparent p-0 shadow-none"
              onPick={onPickEmoji}
            />
          )}
          {tab === 'stickers' && (
            <StickerPicker className="h-full min-h-0" onPick={onPickSticker} />
          )}
          {tab === 'gif' && (
            <GifPicker className="h-full min-h-0" onPick={onPickGif} />
          )}
        </div>

        {/* Вкладки первого уровня в нижней части для удобства на мобильных и ПК */}
        <div
          aria-label={t('mediaPicker.tabs', 'Вкладки медиа')}
          className="mt-auto flex shrink-0 items-center gap-1 border-t border-divider pt-2"
          role="tablist"
        >
          {TABS.map((item) => (
            <Button
              aria-selected={tab === item.key}
              className="flex-1 gap-1.5"
              key={item.key}
              onClick={() => setTab(item.key)}
              role="tab"
              size="sm"
              type="button"
              variant={tab === item.key ? 'primary' : 'ghost'}
            >
              <Icon className="size-4" name={item.icon} />
              <span>{t(item.labelKey, item.defaultLabel)}</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }
);

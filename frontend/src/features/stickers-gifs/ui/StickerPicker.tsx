import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStickerPacksQuery, useStickersQuery, type ISticker } from '@/entities/media';
import { cn } from '@/shared/lib';
import { Button, Icon } from '@/shared/ui';

interface Props {
  onPick: (sticker: ISticker) => void;
  className?: string;
}

export const StickerPicker = ({ onPick, className }: Props) => {
  const { t } = useTranslation();
  const { data: packs = [], isLoading: isLoadingPacks } = useStickerPacksQuery();

  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  const activePackId = selectedPackId ?? packs[0]?.id ?? '';
  const { data: stickers = [], isLoading: isLoadingStickers } = useStickersQuery(activePackId);

  if (isLoadingPacks) {
    return (
      <div
        className={cn(
          'flex h-full min-h-0 flex-1 items-center justify-center text-meta text-ink-3',
          className
        )}
      >
        {t('stickers.loading', 'Загрузка стикеров...')}
      </div>
    );
  }

  if (packs.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full min-h-0 flex-1 flex-col items-center justify-center px-4 py-8 text-center text-ink-3',
          className
        )}
      >
        <Icon className="mb-2 size-10 opacity-50" name="sticker" />
        <span className="text-ui font-medium text-ink-2">
          {t('stickers.emptyTitle', 'Нет наборов стикеров')}
        </span>
        <span className="mt-1 text-meta text-ink-3">
          {t('stickers.emptyDesc', 'У вас пока нет добавленных наборов стикеров')}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-2', className)}>
      <div
        aria-label={t('stickers.packs', 'Наборы стикеров')}
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 scrollbar-none"
        role="tablist"
      >
        {packs.map((pack) => {
          const isSelected = activePackId === pack.id;
          return (
            <Button
              aria-label={pack.name}
              aria-selected={isSelected}
              className="size-9 shrink-0 p-0"
              iconOnly
              key={pack.id}
              onClick={() => setSelectedPackId(pack.id)}
              role="tab"
              size="sm"
              title={pack.name}
              type="button"
              variant={isSelected ? 'primary' : 'secondary'}
            >
              {pack.iconUrl ? (
                <img alt={pack.name} className="size-6 rounded-xs object-cover" src={pack.iconUrl} />
              ) : (
                <span className="text-micro font-semibold">
                  {pack.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </Button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin" role="tabpanel">
        {isLoadingStickers ? (
          <div className="flex h-full items-center justify-center text-meta text-ink-3">
            {t('stickers.loadingPack', 'Загрузка...')}
          </div>
        ) : stickers.length > 0 ? (
          <div className="grid grid-cols-4 gap-2 p-1">
            {stickers.map((sticker) => (
              <button
                aria-label={t('stickers.pickSticker', 'Стикер')}
                className="group flex aspect-square cursor-pointer items-center justify-center rounded-field p-1 hover:layer-hover active:layer-press focus-visible:outline-2 focus-visible:outline-brand"
                key={sticker.id}
                onClick={() => onPick(sticker)}
                type="button"
              >
                <img
                  alt=""
                  className="size-full object-contain transition-transform duration-150 group-hover:scale-105"
                  loading="lazy"
                  src={sticker.imageUrl}
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-3 py-12 text-center text-ui text-ink-3">
            {t('stickers.emptyPack', 'В этом наборе пока нет стикеров')}
          </div>
        )}
      </div>
    </div>
  );
};

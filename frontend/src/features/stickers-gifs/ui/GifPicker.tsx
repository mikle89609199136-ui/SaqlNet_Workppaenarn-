import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useFavoriteGifsQuery,
  useGifsQuery,
  useToggleFavoriteGifMutation,
  type IGif,
} from '@/entities/media';
import { cn } from '@/shared/lib';
import { Button, Icon, Input } from '@/shared/ui';

interface Props {
  onPick: (gif: IGif) => void;
  className?: string;
}

type TGifSubTab = 'all' | 'favorites';

interface IGifSubTabConfig {
  id: TGifSubTab;
  labelKey: string;
  defaultLabel: string;
  icon?: 'heart';
}

const GIF_SUB_TABS: readonly IGifSubTabConfig[] = [
  { id: 'all', labelKey: 'gifs.all', defaultLabel: 'Все' },
  { id: 'favorites', labelKey: 'gifs.favorites', defaultLabel: 'Избранные', icon: 'heart' },
];

export const GifPicker = ({ onPick, className }: Props) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [subTab, setSubTab] = useState<TGifSubTab>('all');

  const { data: allGifs = [], isLoading: isLoadingAll } = useGifsQuery();
  const { data: favoriteGifs = [], isLoading: isLoadingFavorites } = useFavoriteGifsQuery();
  const toggleFavorite = useToggleFavoriteGifMutation();

  const favoriteIds = useMemo(
    () => new Set(favoriteGifs.map((gif) => gif.id)),
    [favoriteGifs]
  );

  const search = query.trim().toLowerCase();
  const currentList = subTab === 'favorites' ? favoriteGifs : allGifs;
  const filteredList = useMemo(() => {
    if (!search) return currentList;
    return currentList.filter((gif) => gif.name.toLowerCase().includes(search));
  }, [currentList, search]);

  const isLoading = subTab === 'favorites' ? isLoadingFavorites : isLoadingAll;

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-2', className)}>
      <Input
        aria-label={t('gifs.search', 'Поиск GIF')}
        className="shrink-0"
        icon="search"
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('gifs.search', 'Поиск GIF')}
        size="sm"
        type="search"
        value={query}
      />

      <div
        aria-label={t('gifs.tabs', 'Вкладки GIF')}
        className="grid w-full shrink-0 grid-cols-2 gap-1.5"
        role="tablist"
      >
        {GIF_SUB_TABS.map((tab) => {
          const isActive = subTab === tab.id;
          return (
            <Button
              aria-selected={isActive}
              className={cn('w-full', tab.id === 'favorites' && 'gap-1.5')}
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              role="tab"
              size="sm"
              type="button"
              variant={isActive ? 'primary' : 'secondary'}
            >
              {tab.icon && <Icon className="size-4" name={tab.icon} />}
              <span>{t(tab.labelKey, tab.defaultLabel)}</span>
              {tab.id === 'favorites' && favoriteGifs.length > 0 && (
                <span className="text-micro opacity-75">({favoriteGifs.length})</span>
              )}
            </Button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin" role="tabpanel">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-meta text-ink-3">
            {t('gifs.loading', 'Загрузка GIF...')}
          </div>
        ) : filteredList.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 p-1">
            {filteredList.map((gif) => {
              const isFav = favoriteIds.has(gif.id);
              return (
                <div
                  aria-label={gif.name}
                  className="group relative flex h-24 cursor-pointer overflow-hidden rounded-field border border-divider bg-sheet transition-transform hover:scale-[1.02] focus-within:outline-2 focus-within:outline-brand"
                  key={gif.id}
                  onClick={() => onPick(gif)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onPick(gif);
                    }
                  }}
                >
                  <img
                    alt={gif.name}
                    className="size-full object-cover"
                    loading="lazy"
                    src={gif.url}
                  />
                  <Button
                    aria-label={
                      isFav
                        ? t('gifs.removeFromFavorites', 'Удалить из избранного')
                        : t('gifs.addToFavorites', 'В избранное')
                    }
                    className={cn(
                      'absolute top-1.5 right-1.5 bg-menu/80 backdrop-blur-xs transition-[opacity,transform] duration-150 hover:scale-110',
                      isFav
                        ? 'opacity-100 text-brand'
                        : 'opacity-0 text-ink-3 group-hover:opacity-100 hover:text-ink'
                    )}
                    iconOnly
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite.mutate({ gifId: gif.id, isFavorite: isFav });
                    }}
                    shape="round"
                    size="xs"
                    title={
                      isFav
                        ? t('gifs.removeFromFavorites', 'Удалить из избранного')
                        : t('gifs.addToFavorites', 'В избранное')
                    }
                    type="button"
                    variant="ghost"
                  >
                    <Icon
                      className={cn('size-3.5', isFav && 'fill-current')}
                      name="heart"
                    />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : search ? (
          <p className="m-0 px-3 py-12 text-center text-ui text-ink-3">
            {t('gifs.nothingFound', 'Ничего не нашлось')}
          </p>
        ) : subTab === 'favorites' ? (
          <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center text-ink-3">
            <Icon className="mb-2 size-8 opacity-40" name="heart" />
            <span className="text-ui font-medium text-ink-2">
              {t('gifs.emptyFavoritesTitle', 'Нет избранных GIF')}
            </span>
            <span className="mt-1 text-meta text-ink-3">
              {t('gifs.emptyFavoritesDesc', 'Нажмите на сердечко у любого GIF, чтобы сохранить сюда')}
            </span>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center text-ink-3">
            <Icon className="mb-2 size-8 opacity-40" name="image" />
            <span className="text-ui font-medium text-ink-2">
              {t('gifs.emptyAllTitle', 'Пока нет GIF')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

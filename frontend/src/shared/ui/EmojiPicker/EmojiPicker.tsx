import { EMOJI_CATEGORIES, EMOJI_KEYWORDS, type TEmojiCategoryKey } from '@/shared/config';
import { cn } from '@/shared/lib';
import { Icon } from '@/shared/ui/Icon';
import { NotoEmoji } from '@/shared/ui/NotoEmoji';
import { forwardRef, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { readRecentEmoji, rememberEmoji } from './recentEmoji';

interface Props {
  id?: string;
  /** Выбран эмодзи. */
  onPick: (emoji: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
}

const ALL_EMOJI = [...new Set(EMOJI_CATEGORIES.flatMap((category) => category.emoji))];

/** Подпись кнопки — первое слово на языке интерфейса: «класс», «thumbs up». */
function nameOf(emoji: string, language: string): string {
  const words = EMOJI_KEYWORDS[emoji];
  if (!words) return emoji;
  return (language.startsWith('ru') ? words[0] : words[1]).split(',')[0];
}

/** Ищем на обоих языках: раскладку и язык интерфейса человек не выбирает под поиск. */
const matches = (emoji: string, search: string) =>
  EMOJI_KEYWORDS[emoji]?.some((words) => words.toLowerCase().includes(search)) ?? false;

/**
 * Панель эмодзи — по макету (#824): поиск, вкладки категорий, сетка по 8,
 * атрибуция Noto. Картинки — Noto из статики приложения. Выбранное
 * попадает в «Недавние».
 */
export const EmojiPicker = forwardRef<HTMLDivElement, Props>(function EmojiPicker(
  { id, onPick, onKeyDown, className },
  ref
) {
  const { t, i18n } = useTranslation();
  const language = i18n.language ?? 'ru';
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<TEmojiCategoryKey>('recent');
  const [recent, setRecent] = useState(readRecentEmoji);

  const search = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (search) return ALL_EMOJI.filter((emoji) => matches(emoji, search));
    if (category === 'recent') return recent;
    return EMOJI_CATEGORIES.find((item) => item.key === category)?.emoji ?? [];
  }, [search, category, recent]);

  const current = EMOJI_CATEGORIES.find((item) => item.key === category) ?? EMOJI_CATEGORIES[0];
  const title = search
    ? t('emoji.searchResults', 'Результаты поиска')
    : t(current.label[0], current.label[1]);

  const pick = (emoji: string) => {
    setRecent((list) => rememberEmoji(list, emoji));
    onPick(emoji);
  };

  return (
    <div
      aria-label={t('emoji.title', 'Эмодзи')}
      className={cn(
        'flex flex-col gap-2 rounded-dialog border border-line bg-menu p-2.5 shadow-[var(--shadow-menu)]',
        className
      )}
      id={id}
      onKeyDown={onKeyDown}
      ref={ref}
      role="dialog"
      tabIndex={-1}
    >
      <label className="flex h-9.5 items-center gap-2 rounded-icon bg-sheet-2 px-3 text-ink-3">
        <Icon aria-hidden="true" className="size-4" name="search" />
        <input
          aria-label={t('emoji.search', 'Поиск эмодзи')}
          className="min-w-0 grow border-0 bg-transparent text-ui text-ink outline-none placeholder:text-ink-3"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('emoji.search', 'Поиск эмодзи')}
          type="search"
          value={query}
        />
      </label>

      <div
        aria-label={t('emoji.categories', 'Категории эмодзи')}
        className="grid grid-cols-5 gap-0.5"
        role="tablist"
      >
        {EMOJI_CATEGORIES.map((item) => {
          const selected = !search && item.key === category;
          const label = t(item.label[0], item.label[1]);
          return (
            <button
              aria-label={label}
              aria-selected={selected}
              className={cn(
                'flex h-8.5 cursor-pointer items-center justify-center rounded-field transition-[background-color,opacity] duration-[160ms]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                selected ? 'bg-brand-soft' : 'opacity-70 hover:opacity-100'
              )}
              key={item.key}
              onClick={() => {
                setCategory(item.key);
                setQuery('');
              }}
              role="tab"
              title={label}
              type="button"
            >
              <NotoEmoji emoji={item.icon} size={22} />
            </button>
          );
        })}
      </div>

      <div className="px-1 text-meta font-semibold text-ink-3">{title}</div>

      <div className="h-52 overflow-y-auto [scrollbar-width:thin]" role="tabpanel">
        {shown.length > 0 ? (
          <div className="grid grid-cols-8 content-start gap-0.5">
            {shown.map((emoji) => (
              <button
                aria-label={nameOf(emoji, language)}
                className={cn(
                  'flex h-9.5 cursor-pointer items-center justify-center rounded-field hover:layer-hover active:layer-press',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand'
                )}
                key={emoji}
                onClick={() => pick(emoji)}
                title={nameOf(emoji, language)}
                type="button"
              >
                <NotoEmoji emoji={emoji} size={28} />
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 px-3 py-12 text-center text-ui text-ink-3">
            {t('emoji.nothingFound', 'Ничего не нашлось')}
          </p>
        )}
      </div>

      <div className="px-1 text-micro text-ink-3">
        {t('emoji.attribution', 'Эмодзи:')}{' '}
        <a
          className="text-ink-2 underline decoration-1 underline-offset-2"
          href="https://googlefonts.github.io/noto-emoji-animation/"
          rel="noopener noreferrer"
          target="_blank"
        >
          Noto Emoji
        </a>
        , Apache 2.0 {t('emoji.and', 'и')} CC BY 4.0
      </div>
    </div>
  );
});

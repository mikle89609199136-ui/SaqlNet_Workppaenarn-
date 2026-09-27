import { cn } from '@/shared/lib';
import { useState } from 'react';

/* Картинки Noto Emoji с Google Fonts — тот же набор, что шрифт эмодзи в
   тексте (#816), только картинкой: у реакций он ещё и анимированный.
   Адрес строится из кодовых точек: «❤️» → 2764 (селектор вида FE0F в
   именах файлов Noto не участвует). */
const BASE = 'https://fonts.gstatic.com/s/e/notoemoji/latest';

export function notoCode(emoji: string): string {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0)!.toString(16))
    .filter((code) => code !== 'fe0f')
    .join('_');
}

export const notoStaticUrl = (emoji: string) => `${BASE}/${notoCode(emoji)}/emoji.svg`;
export const notoAnimatedUrl = (emoji: string) => `${BASE}/${notoCode(emoji)}/512.webp`;

interface Props {
  emoji: string;
  /** Сторона в пикселях. */
  size: number;
  /** Проиграть анимацию: анимированная картинка вместо статичной. */
  animated?: boolean;
  className?: string;
}

/**
 * Эмодзи картинкой Noto (#820, #824).
 *
 * Картинка — украшение: что это за эмодзи, говорит подпись элемента, в
 * котором она стоит. Нет картинки (редкий символ, нет сети) — остаётся
 * сам символ, его нарисует шрифт; нет анимации — статичная.
 */
export function NotoEmoji({ emoji, size, animated = false, className }: Props) {
  const [failed, setFailed] = useState<'none' | 'animated' | 'all'>('none');

  if (failed === 'all') {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-block text-center leading-none', className)}
        style={{ width: size, height: size, fontSize: size * 0.85 }}
      >
        {emoji}
      </span>
    );
  }

  const useAnimated = animated && failed === 'none';

  return (
    <img
      alt=""
      className={cn('block shrink-0 select-none', className)}
      draggable={false}
      height={size}
      onError={() => setFailed(useAnimated ? 'animated' : 'all')}
      src={useAnimated ? notoAnimatedUrl(emoji) : notoStaticUrl(emoji)}
      width={size}
    />
  );
}

import { NOTO_ANIMATED, NOTO_STATIC, notoCode } from '@/shared/config';
import { cn, useReducedMotion } from '@/shared/lib';
import { useState } from 'react';

/* Картинки Noto Emoji — в статике приложения (#824), без запросов к
   Google: SVG у набора панели и реакций, анимация — у быстрых реакций. */
const BASE = '/emoji/noto';

const notoStaticUrl = (emoji: string) => `${BASE}/${notoCode(emoji)}.svg`;
const notoAnimatedUrl = (emoji: string) => `${BASE}/${notoCode(emoji)}.webp`;

interface Props {
  emoji: string;
  /** Сторона в пикселях. */
  size: number;
  /**
   * Проиграть анимацию. Анимация грузится только тогда и ложится поверх
   * статичной картинки, когда загрузилась: без мигания пустым местом.
   * При «уменьшить движение» остаётся статичная.
   */
  animated?: boolean;
  className?: string;
}

/**
 * Эмодзи картинкой Noto (#820, #824).
 *
 * Картинка — украшение: что это за эмодзи, говорит подпись элемента, в
 * котором она стоит. Эмодзи не из набора (или картинка не загрузилась)
 * рисует шрифт Noto Color Emoji (#816) — вид тот же.
 */
export function NotoEmoji({ emoji, size, animated = false, className }: Props) {
  const reducedMotion = useReducedMotion();
  const code = notoCode(emoji);
  const [failed, setFailed] = useState(false);
  const [animationReady, setAnimationReady] = useState(false);

  const box = { width: size, height: size };

  if (failed || !NOTO_STATIC.has(code)) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-block shrink-0 text-center leading-none', className)}
        style={{ ...box, fontSize: size * 0.85 }}
      >
        {emoji}
      </span>
    );
  }

  const playing = animated && !reducedMotion && NOTO_ANIMATED.has(code);
  // Остановили — в следующий раз снова ждём загрузки, а не прячем
  // статичную раньше времени.
  if (!playing && animationReady) setAnimationReady(false);
  const showAnimation = playing && animationReady;

  return (
    <span aria-hidden="true" className={cn('relative block shrink-0', className)} style={box}>
      <img
        alt=""
        className={cn('absolute inset-0 block select-none', showAnimation && 'opacity-0')}
        draggable={false}
        height={size}
        onError={() => setFailed(true)}
        src={notoStaticUrl(emoji)}
        width={size}
      />
      {playing && (
        <img
          alt=""
          className={cn('absolute inset-0 block select-none', !showAnimation && 'opacity-0')}
          draggable={false}
          height={size}
          onError={() => setAnimationReady(false)}
          onLoad={() => setAnimationReady(true)}
          src={notoAnimatedUrl(emoji)}
          width={size}
        />
      )}
    </span>
  );
}

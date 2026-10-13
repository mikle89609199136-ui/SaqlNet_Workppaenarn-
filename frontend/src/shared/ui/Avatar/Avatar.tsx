import { useState } from 'react';
import { cn } from '@/shared/lib';
import { useAvatarShape, type TAvatarShape } from './avatarShape';
import { GridMark } from './GridMark';

/* Цвета перечислены готовыми именами классов, а не собираются из кусков:
   Tailwind ищет их в исходниках подстрокой и не выпустит то, чего не
   увидел. Из-за этого до сих пор существовали только av-1 и av-4 —
   единственные, что были написаны целиком. */
const tones = ['bg-av-1', 'bg-av-2', 'bg-av-3', 'bg-av-4', 'bg-av-5', 'bg-av-6'] as const;

/* Ступени дизайн-системы (#817) и макета:
     xs  24 — в чипе выбранного участника
     header 36 — своя аватарка в шапке списка чатов (макет, #818)
     sm  32 — комментарии, участники группы
     md  40 — шапка чата
     sample 44 — образец вида аватарки во «Внешнем виде» (#828)
     lg  46 — строка списка: имя и превью в два ряда
     menu 52 — своя карточка в меню настроек (#828)
     xl  56 — крупные строки настроек
     card 72 — карточка профиля в «Аккаунте» и форма профиля (#828)
     2xl 96 — профиль, сведения о группе и канале, входящий звонок

   Точка «в сети» — по макету, для каждой ступени своя. Размер указан
   вместе с обводкой: в строке списка зелёный круг 12px и обводка 2px
   снаружи, всего 16; в шапке — 12 вместе с обводкой, на пиксель наружу;
   в профиле — 18 с обводкой 3 и отступом 4 от края. */
const sizes = {
  xs: { box: 'size-6 text-micro', dot: 'size-2 border-2 right-0 bottom-0', grid: 24 },
  sm: { box: 'size-8 text-caption', dot: 'size-2.5 border-2 right-0 bottom-0', grid: 32 },
  header: { box: 'size-9 text-ui', dot: 'size-3 border-2 -right-px -bottom-px', grid: 36 },
  md: { box: 'size-10 text-body', dot: 'size-3 border-2 -right-px -bottom-px', grid: 40 },
  sample: { box: 'size-11 text-[18px]', dot: 'size-3 border-2 -right-px -bottom-px', grid: 44 },
  lg: { box: 'size-11.5 text-title', dot: 'size-4 border-2 right-0 bottom-0', grid: 46 },
  menu: { box: 'size-13 text-[20px]', dot: 'size-4 border-2 right-0 bottom-0', grid: 52 },
  xl: { box: 'size-14 text-section', dot: 'size-4 border-2 right-0 bottom-0', grid: 56 },
  card: { box: 'size-18 text-[28px]', dot: 'size-4.5 border-3 right-0.5 bottom-0.5', grid: 72 },
  '2xl': { box: 'size-24 text-display', dot: 'size-4.5 border-3 right-1 bottom-1', grid: 96 },
} as const;

/* Тот же хеш, что был в Identicon: он уже разложен по чужим аватаркам,
   и менять его значит перекрасить всех разом без причины. */
function hashBytes(value: string) {
  const bytes = new Uint8Array(16);
  let seed = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    seed ^= value.charCodeAt(i);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }

  for (let i = 0; i < 16; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    bytes[i] = (seed >>> 24) & 0xff;
  }

  return bytes;
}

interface Props {
  /* От него цвет и рисунок. У групп и каналов его нет. */
  id?: string | null;
  /* От него буква. У групп это единственное, чем можно различать. */
  name?: string | null;
  /* Фотография, если она есть. */
  src?: string | null;
  size?: keyof typeof sizes;
  /* Чем заменять фотографию. Сетку можно нарисовать только от id,
     поэтому у групп и каналов буква остаётся в любом случае.
     Без пропа вид берётся из настроек оформления (#375). */
  shape?: TAvatarShape;
  online?: boolean;
  /* На чём лежит аватарка: обводка точки «в сети» — цвета этого фона.
     Панель — по умолчанию; шапка чата лежит на фоне ленты. */
  surface?: 'sheet' | 'chat';
  className?: string;
}

export const Avatar = ({
  id,
  name,
  src,
  size = 'md',
  shape,
  online = false,
  surface = 'sheet',
  className,
}: Props) => {
  /* Проп важнее настройки: он ставится там, где вид выбран замыслом
     экрана, а не человеком в настройках. */
  const preferredShape = useAvatarShape();
  const resolvedShape = shape ?? preferredShape;
  const { box, dot, grid } = sizes[size];
  const bytes = hashBytes(id || name || 'anon');
  const tone = tones[bytes[0] % tones.length];
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';

  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src && failedSrc !== src);

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {/* Аватарка всегда рядом с именем, поэтому для скринридера она
          украшение: имя он и так прочитает, а «А на синем круге» — нет. */}
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex items-center justify-center overflow-hidden rounded-pill font-semibold text-on-brand',
          box,
          !showImage && tone
        )}
      >
        {showImage ? (
          // Лениво: в длинном списке чатов качаются только видимые аватарки.
          <img
            alt=""
            className="size-full object-cover"
            decoding="async"
            loading="lazy"
            onError={() => setFailedSrc(src ?? null)}
            src={src ?? undefined}
          />
        ) : resolvedShape === 'grid' && id ? (
          <GridMark bytes={bytes} box={grid} />
        ) : (
          letter
        )}
      </span>

      {online && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute rounded-pill bg-ok',
            surface === 'chat' ? 'border-chat-bg' : 'border-sheet',
            dot
          )}
        />
      )}
    </span>
  );
};

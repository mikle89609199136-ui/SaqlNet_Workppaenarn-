import { cn } from '@/shared/lib';
import { useAvatarShape, type TAvatarShape } from './avatarShape';

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
     lg  46 — строка списка: имя и превью в два ряда
     xl  56 — крупные строки настроек
     2xl 96 — профиль, сведения о группе и канале, входящий звонок

   Точка «в сети» — 12px с обводкой цвета панели, на крупных — больше. */
const sizes = {
  xs: { box: 'size-6 text-micro', dot: 'size-2', grid: 24 },
  sm: { box: 'size-8 text-caption', dot: 'size-2.5', grid: 32 },
  header: { box: 'size-9 text-ui', dot: 'size-2.5', grid: 36 },
  md: { box: 'size-10 text-body', dot: 'size-3', grid: 40 },
  lg: { box: 'size-11.5 text-title', dot: 'size-3', grid: 46 },
  xl: { box: 'size-14 text-section', dot: 'size-3.5', grid: 56 },
  '2xl': { box: 'size-24 text-display', dot: 'size-5', grid: 96 },
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

/* Сетка нарисована на 70% круга и по центру: если растянуть её на весь
   квадрат, скруглённые углы срежут крайние клетки и рисунок читается
   обрывком. */
function GridMark({ bytes, box }: { bytes: Uint8Array; box: number }) {
  const field = box * 0.7;
  const offset = (box - field) / 2;
  const cell = field / 5;
  const rects = [];

  let byteIndex = 2;
  let bitShift = 0;

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const filled = (bytes[byteIndex] >> bitShift) & 1;
      bitShift++;

      if (bitShift === 8) {
        bitShift = 0;
        byteIndex++;
      }

      if (!filled) continue;

      const y = offset + row * cell;
      rects.push(
        <rect key={`${row}-${col}`} x={offset + col * cell} y={y} width={cell} height={cell} />
      );

      if (col !== 2) {
        rects.push(
          <rect
            key={`${row}-m${col}`}
            x={offset + (4 - col) * cell}
            y={y}
            width={cell}
            height={cell}
          />
        );
      }
    }
  }

  return (
    <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} fill="currentColor">
      {rects}
    </svg>
  );
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
  className?: string;
}

export const Avatar = ({ id, name, src, size = 'md', shape, online = false, className }: Props) => {
  /* Проп важнее настройки: он ставится там, где вид выбран замыслом
     экрана, а не человеком в настройках. */
  const preferredShape = useAvatarShape();
  const resolvedShape = shape ?? preferredShape;
  const { box, dot, grid } = sizes[size];
  const bytes = hashBytes(id || name || 'anon');
  const tone = tones[bytes[0] % tones.length];
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {/* Аватарка всегда рядом с именем, поэтому для скринридера она
          украшение: имя он и так прочитает, а «А на синем круге» — нет. */}
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex items-center justify-center overflow-hidden rounded-pill font-semibold text-on-brand',
          box,
          !src && tone
        )}
      >
        {src ? (
          <img alt="" src={src} className="size-full object-cover" />
        ) : resolvedShape === 'grid' && id ? (
          <GridMark bytes={bytes} box={grid} />
        ) : (
          letter
        )}
      </span>

      {online && (
        <span
          aria-hidden="true"
          className={cn('absolute right-0 bottom-0 rounded-pill border-2 border-sheet bg-ok', dot)}
        />
      )}
    </span>
  );
};

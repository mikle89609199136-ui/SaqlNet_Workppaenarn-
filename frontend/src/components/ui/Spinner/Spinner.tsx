import { cn } from '@/utils';

/* Размеры 16/24/40 взяты из UI-кита. Отдельный `text` — для кнопок и строк
   текста: там кружок должен быть ростом со шрифт, а не одного из трёх
   фиксированных размеров, поэтому он задан в `em` и едет за кеглем сам. */
const sizes = {
  text: 'size-[1em] border-[0.125em]',
  sm: 'size-4 border-2',
  md: 'size-6 border-[2.5px]',
  lg: 'size-10 border-[3px]',
} as const;

/* Сам по себе спиннер акцентный, как в ките. Внутри кнопки он обязан
   наследовать её цвет: на заливке акцентом ободок из --line не виден. */
const tones = {
  brand: 'border-line border-t-brand',
  current: 'border-current/25 border-t-current',
} as const;

interface Props {
  size?: keyof typeof sizes;
  tone?: keyof typeof tones;
  /* Без подписи спиннер скрыт от скринридера: внутри кнопки о загрузке
     сообщает её aria-busy, и второе объявление только мешает. Сам по себе
     спиннер — единственное, что есть на экране, и подпись обязательна. */
  label?: string;
  className?: string;
}

export const Spinner = ({ size = 'md', tone = 'brand', label, className }: Props) => {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-pill motion-reduce:animate-none',
        sizes[size],
        tones[tone],
        className
      )}
    />
  );
};

import { cn } from '@/shared/lib';

interface Props {
  /* Форма задаётся утилитами прямо на месте: у скелетона нет своих
     размеров, он повторяет то, что заменяет. */
  className?: string;
}

export const Skeleton = ({ className }: Props) => {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block rounded-control bg-[image:var(--skeleton-sheen)] bg-[length:200%_100%]',
        'animate-[skeleton-sheen_1.4s_linear_infinite]',
        /* Без движения остаётся ровная подложка, а не застывший блик
           поперёк блока. */
        'motion-reduce:animate-none motion-reduce:bg-none motion-reduce:bg-skeleton',
        className
      )}
    />
  );
};

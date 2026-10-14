import { Icon } from '@/shared/ui';
import { cn } from '@/shared/lib';
import type { ButtonHTMLAttributes } from 'react';
import type { TIconTypes } from '@/types';

type TTone = 'control' | 'active' | 'accept' | 'reject';
type TSize = 'sm' | 'md' | 'lg' | 'xl';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: TIconTypes;
  tone?: TTone;
  size?: TSize;
  caption?: string;
  iconClassName?: string;
}

const SIZES: Record<TSize, { box: string; icon: string }> = {
  sm: { box: 'size-8', icon: 'size-4' },
  md: { box: 'size-11', icon: 'size-5' },
  lg: { box: 'size-14', icon: 'size-6' },
  xl: { box: 'size-17', icon: 'size-7' },
};

const TONES: Record<TTone, string> = {
  control: 'bg-scrim-control text-on-scrim hover:bg-scrim-control-hover',
  active: 'bg-on-scrim text-call-ground',
  accept: 'bg-call-accept text-on-scrim',
  reject: 'bg-call-reject text-on-scrim',
};

export function CallButton({
  icon,
  tone = 'control',
  size = 'lg',
  caption,
  iconClassName,
  className,
  type = 'button',
  ...props
}: Props) {
  return (
    <button
      className={cn(
        'group flex shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-pill disabled:cursor-default disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-scrim',
        className
      )}
      type={type}
      {...props}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-pill transition-[transform,background-color] duration-fast group-active:scale-95 motion-reduce:transition-none',
          SIZES[size].box,
          TONES[tone]
        )}
      >
        <Icon className={cn(SIZES[size].icon, iconClassName)} name={icon} />
      </span>
      {caption && (
        <span aria-hidden="true" className="text-[12px] font-medium text-on-scrim/85">
          {caption}
        </span>
      )}
    </button>
  );
}

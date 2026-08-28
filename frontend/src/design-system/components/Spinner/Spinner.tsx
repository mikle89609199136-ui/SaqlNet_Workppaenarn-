import { cn } from '@/utils';

const sizes = {
  sm: 'size-3.5 border-2',
  md: 'size-4 border-2',
  lg: 'size-5 border-[2.5px]',
} as const;

interface Props {
  size?: keyof typeof sizes;
}

export const Spinner = ({ size = 'md' }: Props) => {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 animate-spin rounded-pill border-current/25 border-t-current',
        sizes[size]
      )}
    />
  );
};

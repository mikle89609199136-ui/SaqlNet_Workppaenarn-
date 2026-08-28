import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/utils';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

const sizes = {
  sm: 'text-micro px-3 py-1.5 rounded-control gap-1.5',
  md: 'text-body px-4.5 py-2.5 rounded-field gap-2',
  lg: 'text-title px-6 py-3.5 rounded-field gap-2',
} as const;

const iconOnlySizes = {
  sm: 'p-1.5 rounded-control',
  md: 'p-2.5 rounded-field',
  lg: 'p-3.5 rounded-field',
} as const;

const variants = {
  primary: 'bg-brand-fill text-on-brand hover:brightness-110',
  secondary: 'bg-sheet-2 text-ink border border-line hover:border-ink-3',
  ghost: 'bg-transparent text-ink-2 hover:bg-sheet-2',
  danger: 'bg-transparent border border-danger text-danger hover:bg-danger/10',
} as const;

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    iconOnly = false,
    disabled,
    className,
    children,
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors duration-fast cursor-pointer',
        'disabled:opacity-42 disabled:cursor-not-allowed',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
        iconOnly ? iconOnlySizes[size] : sizes[size],
        variants[variant],
        className
      )}
      {...rest}
    >
      {loading && <Spinner size={size} />}
      {children}
    </button>
  );
});
import { cn } from '@/utils';
import type { PropsWithChildren } from 'react';

interface Props {
  className?: string;
}

export const ComposerRow = ({ children, className }: PropsWithChildren<Props>) => {
  return (
    <div className={cn('thread-composer-row min-h-11 items-center', className)}>{children}</div>
  );
};

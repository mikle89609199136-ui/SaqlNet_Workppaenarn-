import { cn } from '@/utils';
import { forwardRef, type HTMLAttributes, type PropsWithChildren } from 'react';

interface Props extends HTMLAttributes<HTMLFormElement> {
  className?: string;
}

export const ComposerForm = forwardRef<HTMLFormElement, PropsWithChildren<Props>>(
  ({ className, children, ...props }, formRef) => {
    return (
      <form className={cn('thread-composer', className)} {...props} ref={formRef}>
        <div className="thread-composer-card">{children}</div>
      </form>
    );
  }
);

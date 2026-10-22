import { cn } from '@/shared/lib';
import type { PropsWithChildren } from 'react';

interface Props {
  className?: string;
}

/* Строка поля: кнопки 40×40 и поле одной высоты, при росте текста кнопки
   остаются внизу — как в макете. */
export const ComposerRow = ({ children, className }: PropsWithChildren<Props>) => {
  return (
    <div className={cn('flex items-end gap-0.5 p-(--chat-composer-padding)', className)}>
      {children}
    </div>
  );
};

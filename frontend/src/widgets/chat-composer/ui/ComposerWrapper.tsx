import type { PropsWithChildren } from 'react';
import { composerCard, composerFooter } from './composerStyles';

export const ComposerWrapper = ({ children }: PropsWithChildren) => {
  return (
    <div className={composerFooter}>
      <div className={composerCard}>{children}</div>
    </div>
  );
};

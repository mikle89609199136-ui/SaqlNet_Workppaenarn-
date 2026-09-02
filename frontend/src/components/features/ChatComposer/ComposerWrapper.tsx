import type { PropsWithChildren } from 'react';

export const ComposerWrapper = ({ children }: PropsWithChildren) => {
  return (
    <div className="thread-composer">
      <div className="thread-composer-card">{children}</div>
    </div>
  );
};

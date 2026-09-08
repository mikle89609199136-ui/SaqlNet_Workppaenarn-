import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

describe('скелетон', () => {
  it('should stay hidden from assistive technology', () => {
    /* Диктору сообщать нечего: содержимого ещё нет, а «загружается»
       скажет тот, кто показывает скелетон. */
    const { container } = render(<Skeleton />);

    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('should take its shape from the caller', () => {
    const { container } = render(<Skeleton className="size-12 rounded-pill" />);

    expect(container.firstChild).toHaveClass('size-12', 'rounded-pill');
  });

  it('should go still when the viewer asked for less motion', () => {
    const { container } = render(<Skeleton />);

    expect(container.firstChild).toHaveClass('motion-reduce:animate-none');
  });
});

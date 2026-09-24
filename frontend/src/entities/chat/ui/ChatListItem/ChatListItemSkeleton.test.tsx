import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatListItemSkeleton } from './ChatListItemSkeleton';

describe('скелетон строки чата', () => {
  it('should draw as many rows as asked', () => {
    const { container } = render(<ChatListItemSkeleton rows={3} />);

    expect(container.children).toHaveLength(3);
  });

  it('should match the avatar size of the real row', () => {
    /* Порознь они разъезжаются молча: прежний скелетон рисовал кружок в
       40 пикселей, а строка перешла на 48, и список при загрузке дёргался. */
    const { container } = render(<ChatListItemSkeleton rows={1} />);

    expect(container.querySelector('.size-12')).toBeInTheDocument();
  });

  it('should not catch clicks meant for the list', () => {
    const { container } = render(<ChatListItemSkeleton rows={1} />);

    expect(container.firstElementChild).toHaveClass('pointer-events-none');
  });
});

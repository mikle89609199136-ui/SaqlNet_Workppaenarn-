import { cn, findTextMatches } from '@/shared/lib';
import type { ReactNode } from 'react';

export function highlightMatches(
  text: string,
  query = '',
  current = false,
  keyPrefix = ''
): ReactNode[] {
  const ranges = findTextMatches(text, query);
  if (ranges.length === 0) return [text];

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        className={cn(
          'rounded-[3px] px-px text-inherit',
          current ? 'bg-hl-current text-on-hl-current' : 'bg-hl'
        )}
        data-current={current ? 'true' : undefined}
        key={`${keyPrefix}${start}`}
      >
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

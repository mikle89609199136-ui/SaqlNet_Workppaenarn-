import { memo } from 'react';

interface Props {
  label: string;
}

export const DateDivider = memo(({ label }: Props) => {
  if (!label) return null;

  return (
    <div className="flex justify-center my-3 select-none pointer-events-none">
      <span className="px-3.5 py-1 rounded-pill bg-sheet-2/90 backdrop-blur-md border border-line-soft text-caption font-medium text-ink-3 shadow-xs">
        {label}
      </span>
    </div>
  );
});

DateDivider.displayName = 'DateDivider';

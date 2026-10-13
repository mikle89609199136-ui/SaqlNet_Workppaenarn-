import { memo, type ReactNode } from 'react';
import { buildInlineSegments, type IMessageEntity, type IRichSegment } from '@/shared/lib/richText';
import { cn } from '@/shared/lib';

export interface IMessageSnippetProps {
  text: string;
  entities?: IMessageEntity[];
  className?: string;
}

function renderInlineSegment(segment: IRichSegment, key: string): ReactNode {
  const { formats, url, text } = segment;
  let node: ReactNode = text;

  if (formats.includes('monospace')) {
    node = (
      <code className="rounded bg-brand-soft px-1 py-0.25 font-mono text-[0.88em] text-brand group-aria-[current=page]:bg-on-brand/18 group-aria-[current=page]:text-on-brand">
        {node}
      </code>
    );
  }

  const hasUnderline = formats.includes('underline');
  const hasStrikethrough = formats.includes('strikethrough');
  const hasBold = formats.includes('bold');
  const hasItalic = formats.includes('italic');

  if (hasStrikethrough && hasUnderline) {
    node = (
      <u className="decoration-[1.5px] underline-offset-3">
        <s className="line-through decoration-[1.5px] underline-offset-3">{node}</s>
      </u>
    );
  } else if (hasStrikethrough) {
    node = <s className="line-through decoration-[1.5px] underline-offset-3">{node}</s>;
  } else if (hasUnderline) {
    node = <u className="underline decoration-[1.5px] underline-offset-3">{node}</u>;
  }

  if (hasItalic) node = <em className="italic">{node}</em>;
  if (hasBold) node = <strong className="font-semibold">{node}</strong>;

  if (url || formats.includes('link')) {
    /* Нельзя рендерить <a> внутри <NavLink> (#971): стилизуем как ссылку, но клик ведёт в чат. */
    node = (
      <span
        data-entity="link"
        className="text-brand underline decoration-line-soft underline-offset-3 group-aria-[current=page]:text-on-brand"
      >
        {node}
      </span>
    );
  }

  if (formats.includes('spoiler')) {
    /* Спойлер в превью закрыт маской и не перехватывает клик перехода в чат (#971). */
    node = (
      <span
        aria-hidden="true"
        data-entity="spoiler"
        className="pointer-events-none rounded bg-line/80 px-1 py-0.25 select-none filter blur-[3px]"
      >
        {node}
      </span>
    );
  }

  return <span key={key}>{node}</span>;
}

export const MessageSnippet = memo(({ text, entities, className }: IMessageSnippetProps) => {
  if (!text) return null;

  const segments = buildInlineSegments(text, entities);

  return (
    <span className={cn('inline', className)}>
      {segments.map((segment, index) => renderInlineSegment(segment, String(index)))}
    </span>
  );
});

MessageSnippet.displayName = 'MessageSnippet';

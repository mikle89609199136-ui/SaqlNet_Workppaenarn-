import { memo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildRichBlocks,
  normalizeEntities,
  type IMessageEntity,
  type IRichSegment,
} from '@/shared/lib/richText';
import { cn } from '@/shared/lib';

interface Props {
  content: string;
  /** Форматирование (#656). Нет — текст показывается как есть. */
  entities?: IMessageEntity[];
  trailing?: ReactNode;
}

const HASHTAG = /(#[\wа-яА-ЯёЁ]+)/g;

function withHashtags(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(HASHTAG)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));

    const hashtag = match[0];
    parts.push(
      <span
        key={`${keyPrefix}-${index}`}
        className="cursor-pointer font-bold text-brand hover:underline"
        onClick={() => {
          const searchFn = (window as unknown as { handleUnifiedSearch?: (tag: string) => void })
            .handleUnifiedSearch;
          if (typeof searchFn === 'function') {
            searchFn(hashtag);
          } else {
            alert(`Поиск по хэштегу: ${hashtag}`);
          }
        }}
      >
        {hashtag}
      </span>
    );
    lastIndex = index + hashtag.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

/** Скрытый текст: закрыт, пока его не откроют нажатием. */
function Spoiler({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  if (revealed) return <span className="rounded bg-sheet-2/60">{children}</span>;

  return (
    <span
      aria-label={t('format.spoilerHidden', 'Скрытый текст — нажмите, чтобы показать')}
      className="cursor-pointer select-none rounded bg-ink-3 text-transparent"
      onClick={(event) => {
        event.stopPropagation();
        setRevealed(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setRevealed(true);
        }
      }}
      role="button"
      tabIndex={0}
    >
      {children}
    </span>
  );
}

function renderSegment(segment: IRichSegment, key: string): ReactNode {
  const { formats, url } = segment;
  let node: ReactNode = url ? segment.text : withHashtags(segment.text, key);

  if (formats.includes('monospace')) {
    node = <code className="rounded bg-sheet-2 px-1 font-mono text-[0.92em]">{node}</code>;
  }

  const classes = cn(
    formats.includes('bold') && 'font-semibold',
    formats.includes('italic') && 'italic',
    formats.includes('underline') && 'underline',
    formats.includes('strikethrough') && 'line-through'
  );
  if (classes) node = <span className={classes}>{node}</span>;

  if (url) {
    node = (
      <a
        className="text-brand underline"
        href={url}
        onClick={(event) => event.stopPropagation()}
        rel="noopener noreferrer nofollow"
        target="_blank"
      >
        {node}
      </a>
    );
  }

  if (formats.includes('spoiler')) node = <Spoiler>{node}</Spoiler>;

  return <span key={key}>{node}</span>;
}

export const MessageContentRenderer = memo(({ content, entities, trailing }: Props) => {
  if (!content && !trailing) return null;

  const clean = entities?.length ? normalizeEntities(content, entities) : [];
  const blocks = buildRichBlocks(content, clean);

  return (
    <div className="message-content text-body whitespace-pre-wrap leading-snug [overflow-wrap:anywhere] flow-root">
      {blocks.map((block, blockIndex) => {
        const segments = block.segments.map((segment, index) =>
          renderSegment(segment, `${blockIndex}-${index}`)
        );
        return block.quote ? (
          <blockquote className="my-1 border-l-2 border-brand pl-2 text-ink-2" key={blockIndex}>
            {segments}
          </blockquote>
        ) : (
          <span key={blockIndex}>{segments}</span>
        );
      })}
      {trailing}
    </div>
  );
});

MessageContentRenderer.displayName = 'MessageContentRenderer';

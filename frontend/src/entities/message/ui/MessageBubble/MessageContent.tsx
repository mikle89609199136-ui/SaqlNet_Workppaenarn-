import { memo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildRichBlocks,
  normalizeEntities,
  type IMessageEntity,
  type IRichSegment,
} from '@/shared/lib/richText';
import { cn } from '@/shared/lib';
import { CodeBlock } from './CodeBlock';

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
        className="cursor-pointer font-bold text-brand hover:underline group-data-[mine]/bubble:text-on-brand"
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

  return (
    <span
      aria-label={
        revealed
          ? t('format.spoilerShown', 'Скрыть текст')
          : t('format.spoilerHidden', 'Скрытый текст — нажмите, чтобы показать')
      }
      aria-pressed={revealed}
      className={cn(
        'mx-px cursor-pointer rounded-[5px] px-[3px] transition-colors duration-[360ms]',
        revealed ? 'spoiler-open' : 'spoiler-dust'
      )}
      onClick={(event) => {
        event.stopPropagation();
        setRevealed((value) => !value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setRevealed((value) => !value);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className={revealed ? undefined : 'invisible'}>
        <mark className="bg-transparent text-inherit">{children}</mark>
      </span>
    </span>
  );
}

/** Кавычки в углу цитаты — по макету. */
function QuoteMark() {
  return (
    <svg
      aria-hidden="true"
      className="absolute top-1.75 right-2 size-3.5 text-brand opacity-55 group-data-[mine]/bubble:text-on-brand"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M9.5 6C6.5 6 4 8.5 4 11.5V18h6v-6H7c0-1.7 1.1-3 2.5-3V6zm10 0c-3 0-5.5 2.5-5.5 5.5V18h6v-6h-3c0-1.7 1.1-3 2.5-3V6z" />
    </svg>
  );
}

function renderSegment(segment: IRichSegment, key: string): ReactNode {
  const { formats, url } = segment;
  let node: ReactNode = url ? segment.text : withHashtags(segment.text, key);

  if (formats.includes('monospace')) {
    node = (
      <code className="rounded-control bg-brand-soft px-1.5 py-0.5 font-mono text-[0.88em] [font-variant-ligatures:none] text-brand group-data-[mine]/bubble:bg-on-brand/18 group-data-[mine]/bubble:text-on-brand">
        {node}
      </code>
    );
  }

  const hasUnderline = formats.includes('underline');
  const hasStrikethrough = formats.includes('strikethrough');
  const hasBold = formats.includes('bold');
  const hasItalic = formats.includes('italic');

  const classes = cn(
    hasBold && 'font-semibold',
    hasItalic && 'italic',
    hasUnderline && hasStrikethrough
      ? '[text-decoration-line:underline_line-through]'
      : cn(hasUnderline && 'underline', hasStrikethrough && 'line-through'),
    (hasUnderline || hasStrikethrough) &&
      'decoration-[1.5px] underline-offset-3'
  );

  if (hasStrikethrough && hasUnderline) {
    node = (
      <u className="decoration-[1.5px] underline-offset-3">
        <s className={classes}>{node}</s>
      </u>
    );
  } else if (hasStrikethrough) {
    node = <s className={classes}>{node}</s>;
  } else if (hasUnderline) {
    node = <u className={classes}>{node}</u>;
  } else if (hasItalic && !hasBold) {
    node = <em className={classes}>{node}</em>;
  } else if (hasBold && !hasItalic) {
    node = <strong className={classes}>{node}</strong>;
  } else if (classes) {
    node = <span className={classes}>{node}</span>;
  }

  if (hasItalic && (hasBold || hasUnderline || hasStrikethrough)) {
    node = <em className="italic">{node}</em>;
  }
  if (hasBold && (hasItalic || hasUnderline || hasStrikethrough)) {
    node = <strong className="font-semibold">{node}</strong>;
  }

  if (url) {
    node = (
      <a
        className="text-brand underline decoration-1 underline-offset-3 group-data-[mine]/bubble:text-on-brand"
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
        if (block.kind === 'code') {
          return <CodeBlock code={block.code ?? ''} key={blockIndex} lang={block.lang ?? ''} />;
        }
        return block.kind === 'quote' ? (
          <blockquote
            className="relative my-1 rounded-[8px] border-l-3 border-brand bg-brand-soft py-1.5 pr-7.5 pl-2.5 group-data-[mine]/bubble:border-on-brand group-data-[mine]/bubble:bg-on-brand/14"
            key={blockIndex}
          >
            {segments}
            <QuoteMark />
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

import { memo, type ReactNode } from 'react';

interface Props {
  content: string;
  trailing?: ReactNode;
}

export const MessageContentRenderer = memo(({ content, trailing }: Props) => {
  if (!content && !trailing) return null;

  const parts = [];
  const regex = /(#[\wа-яА-ЯёЁ]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore) {
      parts.push(textBefore);
    }

    const hashtag = match[0];
    parts.push(
      <span
        key={match.index}
        className="cursor-pointer font-bold text-brand hover:underline"
        onClick={() => {
          const searchFn = (
            window as unknown as { handleUnifiedSearch?: (tag: string) => void }
          ).handleUnifiedSearch;
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
    lastIndex = regex.lastIndex;
  }

  const textAfter = content.substring(lastIndex);
  if (textAfter) {
    parts.push(textAfter);
  }

  return (
    <div className="message-content text-body whitespace-pre-wrap leading-snug [overflow-wrap:anywhere] flow-root">
      {parts.length > 0 ? parts : content}
      {trailing}
    </div>
  );
});

MessageContentRenderer.displayName = 'MessageContentRenderer';

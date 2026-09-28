import { useTranslation } from 'react-i18next';
import { useHighlightedCode, type TCodeToken } from '@/shared/lib/highlightCode';
import { Icon, showToast } from '@/shared/ui';

interface Props {
  code: string;
  /** Язык из «```язык»; пусто — определяется по коду. */
  lang: string;
}

function renderTokens(tokens: TCodeToken[], prefix: string) {
  return tokens.map((token, index) =>
    typeof token === 'string' ? (
      token
    ) : (
      <span className={token.className} key={`${prefix}-${index}`}>
        {renderTokens(token.children, `${prefix}-${index}`)}
      </span>
    )
  );
}

/**
 * Блок кода в сообщении (#823): шапка с языком и «Копировать», код с
 * подсветкой и прокруткой вбок. Пока подсветка грузится, код виден как есть.
 */
export function CodeBlock({ code, lang }: Props) {
  const { t } = useTranslation();
  const highlighted = useHighlightedCode(code, lang);
  const label = highlighted?.label || lang || t('format.codeBlock', 'код');

  const copy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => showToast('success', t('format.codeCopied', 'Код скопирован')))
      .catch(() => showToast('error', t('format.copyFailed', 'Не удалось скопировать')));
  };

  return (
    <div className="code-block my-1.5 overflow-hidden rounded-field border border-(--code-line) bg-(--code-bg) whitespace-normal">
      <div className="flex h-7.5 items-center gap-2 bg-(--code-head) pr-1 pl-3 text-meta font-semibold text-(--code-lang)">
        <span className="grow tracking-[0.02em]">{label}</span>
        <button
          aria-label={t('format.copyCode', 'Скопировать код')}
          className="flex h-6 cursor-pointer items-center gap-1.25 rounded-control px-2 text-meta font-medium hover:layer-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          onClick={(event) => {
            // Иначе нажатие уходит в пузырь и открывает меню сообщения.
            event.stopPropagation();
            copy();
          }}
          type="button"
        >
          <Icon className="size-3.25 stroke-2" name="copy" size="xs" />
          {t('format.copy', 'Копировать')}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto px-3 pt-2.5 pb-3 font-mono text-caption leading-[1.55] whitespace-pre [font-variant-ligatures:none] text-(--code-ink) [scrollbar-width:thin] [tab-size:2]">
        <code>{highlighted ? renderTokens(highlighted.tokens, 'k') : code}</code>
      </pre>
    </div>
  );
}

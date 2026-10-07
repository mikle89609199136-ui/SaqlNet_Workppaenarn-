import { useEffect, useState } from 'react';
import type { IHighlightedCode } from './types';

type THighlighter = typeof import('./highlighter');

let loading: Promise<THighlighter> | null = null;

/** highlight.js — отдельным куском, один раз на всё приложение. */
function loadHighlighter(): Promise<THighlighter> {
  loading ??= import('./highlighter').catch((error: unknown) => {
    // Сеть моргнула — следующий блок кода попробует ещё раз.
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * Подсвеченный код (#823). Пока подсветка грузится или если не загрузилась,
 * возвращает null — код показывается как есть.
 */
export function useHighlightedCode(code: string, lang: string): IHighlightedCode | null {
  const [result, setResult] = useState<{ key: string; value: IHighlightedCode } | null>(null);
  const key = `${lang}\n${code}`;

  useEffect(() => {
    let cancelled = false;
    loadHighlighter()
      .then(({ highlightCode }) => {
        if (!cancelled) setResult({ key, value: highlightCode(code, lang) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, key, lang]);

  return result?.key === key ? result.value : null;
}

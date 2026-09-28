import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { TCodeToken, IHighlightedCode } from './types';

/*
 * Подсветка кода в сообщениях (#823). Этот модуль грузится отдельным куском
 * и только когда в переписке есть блок кода: highlight.js в основной
 * бандл не входит. Языки — самые ходовые; остальное показывается без
 * подсветки.
 */

const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dockerfile,
  go,
  java,
  javascript,
  json,
  kotlin,
  php,
  python,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

/** Короткие подписи, как пишут в ```язык. */
const LABELS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  xml: 'html',
  csharp: 'c#',
  cpp: 'c++',
};

/** Ниже этой уверенности автоопределение — скорее догадка: не красим. */
const MIN_RELEVANCE = 3;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
};

const unescape = (text: string) =>
  text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (e) => ENTITIES[e]);

/**
 * Разметка highlight.js → дерево токенов. В ней только `<span class>` и
 * экранированный текст; собираем дерево сами, чтобы код из сообщения ни
 * при каких условиях не попал в innerHTML.
 */
function toTokens(html: string): TCodeToken[] {
  const root: TCodeToken[] = [];
  const stack: TCodeToken[][] = [root];

  for (const match of html.matchAll(/<span class="([^"]*)">|<\/span>|[^<]+/g)) {
    const current = stack[stack.length - 1];
    if (match[1] !== undefined) {
      const children: TCodeToken[] = [];
      current.push({ className: match[1], children });
      stack.push(children);
    } else if (match[0] === '</span>') {
      if (stack.length > 1) stack.pop();
    } else {
      current.push(unescape(match[0]));
    }
  }

  return root;
}

export function highlightCode(code: string, lang: string): IHighlightedCode {
  const named = lang ? hljs.getLanguage(lang) : undefined;

  if (named) {
    const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
    return { label: lang, tokens: toTokens(result.value) };
  }
  // Язык указан, но незнаком — подпись как написано, без подсветки.
  if (lang) return { label: lang, tokens: [code] };

  const result = hljs.highlightAuto(code);
  if (!result.language || result.relevance < MIN_RELEVANCE) return { label: '', tokens: [code] };
  return { label: LABELS[result.language] ?? result.language, tokens: toTokens(result.value) };
}

/** Кусок подсвеченного кода: текст или span с классами highlight.js. */
export type TCodeToken = string | { className: string; children: TCodeToken[] };

export interface IHighlightedCode {
  /** Язык для подписи; пусто — не определён. */
  label: string;
  tokens: TCodeToken[];
}

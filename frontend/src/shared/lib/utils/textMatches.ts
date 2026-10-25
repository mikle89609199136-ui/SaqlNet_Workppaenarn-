export interface ITextRange {
  start: number;
  end: number;
}

function foldChar(char: string): string {
  const lower = char.toLowerCase();
  const folded = lower === 'ё' ? 'е' : lower;
  return folded.length === 1 ? folded : char;
}

const fold = (value: string) => value.split('').map(foldChar).join('');

export function findTextMatches(text: string, query: string): ITextRange[] {
  const needle = fold(query.trim());
  if (!needle || !text) return [];

  const haystack = fold(text);
  const ranges: ITextRange[] = [];
  for (let from = haystack.indexOf(needle); from !== -1;) {
    ranges.push({ start: from, end: from + needle.length });
    from = haystack.indexOf(needle, from + needle.length);
  }
  return ranges;
}

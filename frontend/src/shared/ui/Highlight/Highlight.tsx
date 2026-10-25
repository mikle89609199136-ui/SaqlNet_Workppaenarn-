import { highlightMatches } from './highlightMatches';

interface Props {
  text: string;
  query?: string;
  current?: boolean;
}

export function Highlight({ text, query, current }: Props) {
  return <>{highlightMatches(text, query, current)}</>;
}

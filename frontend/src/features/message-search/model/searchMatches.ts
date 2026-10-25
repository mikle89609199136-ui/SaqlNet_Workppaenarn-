import { findTextMatches } from '@/shared/lib';
import type { IMessageDto } from '@/types';

const SNIPPET_LEAD = 24;

export const isSearchable = (message: IMessageDto) =>
  Boolean(message.content) && !message.undecryptable && message.type !== 'call';

const createdAtOf = (message: IMessageDto) => new Date(message.createdAt).getTime() || 0;

export function collectMatches(messages: Iterable<IMessageDto>, query: string): IMessageDto[] {
  const byId = new Map<string, IMessageDto>();
  for (const message of messages) {
    if (isSearchable(message) && findTextMatches(message.content, query).length > 0) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()].sort((a, b) => createdAtOf(b) - createdAtOf(a));
}

export function snippetAround(text: string, query: string): string {
  const [first] = findTextMatches(text, query);
  if (!first || first.start <= SNIPPET_LEAD) return text;
  return `…${text.slice(first.start - SNIPPET_LEAD).trimStart()}`;
}

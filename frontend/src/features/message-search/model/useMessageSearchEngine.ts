import { useChatUiStore } from '@/entities/chat';
import { MESSAGES_PAGE_SIZE } from '@/entities/message';
import { services } from '@/services/serviceContainer';
import { useDebounce } from '@/shared/lib';
import type { IMessageDto, TMessagesList } from '@/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { collectMatches } from './searchMatches';
import { selectCurrentMatch, useMessageSearchStore } from './messageSearchStore';

export const MAX_HISTORY_PAGES = 40;
const TYPING_PAUSE_MS = 250;

interface Params {
  chatId: string;
  loadedMessages: TMessagesList;
  hasOlder: boolean;
}

interface IHistoryMatches {
  query: string;
  matches: IMessageDto[];
  done: boolean;
}

const NO_HISTORY: IHistoryMatches = { query: '', matches: [], done: true };

export function useMessageSearchEngine({ chatId, loadedMessages, hasOlder }: Params) {
  const isOpen = useMessageSearchStore((state) => state.chatId === chatId);
  const typed = useMessageSearchStore((state) => (state.chatId === chatId ? state.query : ''));
  const query = useDebounce(typed.trim(), TYPING_PAUSE_MS);
  const current = useMessageSearchStore(selectCurrentMatch);
  const setResults = useMessageSearchStore((state) => state.setResults);
  const close = useMessageSearchStore((state) => state.close);
  const setJumpRequest = useChatUiStore((state) => state.setJumpRequest);
  const [history, setHistory] = useState<IHistoryMatches>(NO_HISTORY);

  const loadedCountRef = useRef(loadedMessages.length);
  useEffect(() => {
    loadedCountRef.current = loadedMessages.length;
  }, [loadedMessages.length]);

  const searchesHistory = isOpen && Boolean(query) && hasOlder;
  const searchesHistoryRef = useRef(searchesHistory);
  useEffect(() => {
    searchesHistoryRef.current = searchesHistory;
  }, [searchesHistory]);

  useEffect(() => {
    if (!isOpen || !query || !searchesHistoryRef.current) return undefined;

    let cancelled = false;

    void (async () => {
      let offset = loadedCountRef.current;
      let matches: IMessageDto[] = [];
      for (let page = 0; page < MAX_HISTORY_PAGES && !cancelled; page += 1) {
        const messages = await services.messageService
          .fetchMessagesPage(chatId, offset, MESSAGES_PAGE_SIZE)
          .catch(() => []);
        if (cancelled) return;

        matches = [...matches, ...collectMatches(messages, query)];
        const exhausted = messages.length < MESSAGES_PAGE_SIZE;
        setHistory({ query, matches, done: exhausted });
        if (exhausted) return;
        offset += messages.length;
      }
      if (!cancelled) setHistory({ query, matches, done: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, isOpen, query]);

  const results = useMemo(() => {
    if (!isOpen || !query) return [];
    const fromHistory = history.query === query ? history.matches : [];
    return collectMatches([...loadedMessages, ...fromHistory], query);
  }, [history, isOpen, loadedMessages, query]);

  const isSearchingHistory = searchesHistory && (history.query !== query || !history.done);

  useEffect(() => {
    if (isOpen) setResults(results, isSearchingHistory);
  }, [isOpen, isSearchingHistory, results, setResults]);

  const currentId = current?.id;
  useEffect(() => {
    if (isOpen && currentId) setJumpRequest({ chatId, messageId: currentId });
  }, [chatId, currentId, isOpen, setJumpRequest]);

  useEffect(() => close, [chatId, close]);
}

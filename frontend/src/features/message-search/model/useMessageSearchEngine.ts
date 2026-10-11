import { useChatUiStore } from '@/entities/chat';
import { MESSAGES_PAGE_SIZE } from '@/entities/message';
import { services } from '@/services/serviceContainer';
import { useDebounce } from '@/shared/lib';
import type { IMessageDto, TMessagesList } from '@/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { collectMatches } from './searchMatches';
import {
  selectCurrentMatch,
  useMessageSearchStore,
  type THistoryStatus,
} from './messageSearchStore';

export const MAX_HISTORY_PAGES = 40;
const TYPING_PAUSE_MS = 250;

interface Params {
  chatId: string;
  loadedMessages: TMessagesList;
  hasOlder: boolean;
}

interface IHistoryScan {
  chatId: string;
  messages: IMessageDto[];
  status: THistoryStatus;
}

export function useMessageSearchEngine({ chatId, loadedMessages, hasOlder }: Params) {
  const isOpen = useMessageSearchStore((state) => state.chatId === chatId);
  const typed = useMessageSearchStore((state) => (state.chatId === chatId ? state.query : ''));
  const query = useDebounce(typed.trim(), TYPING_PAUSE_MS);
  const current = useMessageSearchStore(selectCurrentMatch);
  const setResults = useMessageSearchStore((state) => state.setResults);
  const close = useMessageSearchStore((state) => state.close);
  const setJumpRequest = useChatUiStore((state) => state.setJumpRequest);
  const [scan, setScan] = useState<IHistoryScan | null>(null);

  const loadedCountRef = useRef(loadedMessages.length);
  useEffect(() => {
    loadedCountRef.current = loadedMessages.length;
  }, [loadedMessages.length]);

  // История читается один раз за открытый поиск: каждый запрос дальше
  // фильтрует уже собранный текст. Закрытие или смена чата всё выбрасывают.
  const [scanFor, setScanFor] = useState<string | null>(null);
  const openChatId = isOpen ? chatId : null;
  if (scanFor !== null && scanFor !== openChatId) setScanFor(null);
  else if (scanFor === null && openChatId && query && hasOlder) setScanFor(openChatId);

  useEffect(() => {
    if (!scanFor) return undefined;

    let cancelled = false;

    void (async () => {
      let offset = loadedCountRef.current;
      let messages: IMessageDto[] = [];
      for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
        let batch: TMessagesList;
        try {
          batch = await services.messageService.fetchMessageTextsPage(
            scanFor,
            offset,
            MESSAGES_PAGE_SIZE
          );
        } catch {
          if (!cancelled) setScan({ chatId: scanFor, messages, status: 'failed' });
          return;
        }
        if (cancelled) return;

        messages = [...messages, ...batch];
        const exhausted = batch.length < MESSAGES_PAGE_SIZE;
        setScan({ chatId: scanFor, messages, status: exhausted ? 'complete' : 'loading' });
        if (exhausted) return;
        offset += batch.length;
      }
      if (!cancelled) setScan({ chatId: scanFor, messages, status: 'partial' });
    })();

    return () => {
      cancelled = true;
    };
  }, [scanFor]);

  const history = scan && scan.chatId === scanFor ? scan : null;
  const historyStatus: THistoryStatus = !scanFor ? 'complete' : (history?.status ?? 'loading');
  const scannedCount = loadedMessages.length + (history?.messages.length ?? 0);

  const results = useMemo(() => {
    if (!isOpen || !query) return [];
    return collectMatches([...loadedMessages, ...(history?.messages ?? [])], query);
  }, [history, isOpen, loadedMessages, query]);

  useEffect(() => {
    if (isOpen) setResults(results, historyStatus, scannedCount);
  }, [historyStatus, isOpen, results, scannedCount, setResults]);

  const currentId = current?.id;
  useEffect(() => {
    if (isOpen && currentId) setJumpRequest({ chatId, messageId: currentId });
  }, [chatId, currentId, isOpen, setJumpRequest]);

  useEffect(() => close, [chatId, close]);
}

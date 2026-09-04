import { useChatUiStore } from '@/store';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToasts } from './useToasts';

const HIGHLIGHT_DURATION_MS = 1800;

interface IUseJumpToMessageOptions {
  /** Функция скролла к сообщению (например, через виртуализатор) */
  onScrollToMessage?: (messageId: string) => boolean;
  /** Функция подгрузки более старых страниц истории */
  loadOlder?: () => Promise<void> | void;
  /** Флаг наличия более старых страниц */
  hasMoreOlder?: boolean;
}

/**
 * Хук навигации и плавного перехода к сообщению по ID (при клике на цитату или закрепление)
 * с акцентной подсветкой и обработкой незагруженных страниц истории.
 */
export function useJumpToMessage(options?: IUseJumpToMessageOptions) {
  const { t } = useTranslation();
  const { showToast } = useToasts();
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setHighlightedMessageId = useChatUiStore((state) => state.setHighlightedMessageId);

  const applyHighlight = useCallback(
    (messageId: string) => {
      setHighlightedMessageId(messageId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        if (useChatUiStore.getState().highlightedMessageId === messageId) {
          setHighlightedMessageId(null);
        }
      }, HIGHLIGHT_DURATION_MS);
    },
    [setHighlightedMessageId]
  );

  const jumpToMessage = useCallback(
    async (messageId?: string | null) => {
      if (!messageId) return false;

      // 1. Попытка перехода через виртуализатор
      let success = options?.onScrollToMessage?.(messageId) ?? false;

      // 2. Фоллбэк через DOM, если элемент уже смонтирован
      if (!success) {
        const element = document.getElementById(messageId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          success = true;
        }
      }

      // Если сообщение найдено в текущем срезе
      if (success) {
        applyHighlight(messageId);
        return true;
      }

      // 3. Если сообщение выше в истории и есть возможность догрузить
      if (options?.loadOlder && options?.hasMoreOlder) {
        showToast(
          'info',
          t('loadingOlderForJump', 'Загрузка истории для перехода к сообщению...')
        );
        try {
          await options.loadOlder();
          const retrySuccess = options?.onScrollToMessage?.(messageId) ?? false;
          if (retrySuccess) {
            applyHighlight(messageId);
            return true;
          }
        } catch {
          // Игнорируем ошибку сети при подгрузке, покажем тост отсутствия ниже
        }
      }

      showToast('info', t('messageNotInHistory', 'Сообщение находится выше в истории'));
      return false;
    },
    [applyHighlight, options, showToast, t]
  );

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  return { jumpToMessage };
}

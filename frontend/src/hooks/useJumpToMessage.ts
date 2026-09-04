import { useChatUiStore, useToastStore } from '@/store';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const HIGHLIGHT_DURATION_MS = 1800;
const MAX_LOAD_OLDER_ATTEMPTS = 5;

interface IUseJumpToMessageOptions {
  /** Функция скролла к сообщению (например, через виртуализатор) */
  onScrollToMessage?: (messageId: string) => boolean;
  /** Функция подгрузки более старых страниц истории */
  loadOlder?: (options?: { isJump?: boolean }) => Promise<void> | void;
  /** Флаг наличия более старых страниц */
  hasMoreOlder?: boolean;
}

/**
 * Хук навигации и плавного перехода к сообщению по ID (при клике на цитату или закрепление)
 * с акцентной подсветкой и обработкой незагруженных страниц истории.
 */
export function useJumpToMessage(options?: IUseJumpToMessageOptions) {
  const { t } = useTranslation();
  const showToast = useToastStore((state) => state.showToast);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setHighlightedMessageId = useChatUiStore((state) => state.setHighlightedMessageId);

  const optionsRef = useRef(options);
  const pendingJumpTargetRef = useRef<string | null>(null);
  const pendingResolveRef = useRef<((found: boolean) => void) | null>(null);

  // Запись в ссылку — в эффекте, а не в теле хука (#553 review)
  useEffect(() => {
    optionsRef.current = options;

    // Реактивное разрешение ожидания: при обновлении feedItems/опций сразу проверяем наличие цели
    if (pendingJumpTargetRef.current && pendingResolveRef.current) {
      const targetId = pendingJumpTargetRef.current;
      const found = options?.onScrollToMessage?.(targetId) ?? false;
      const resolve = pendingResolveRef.current;
      pendingResolveRef.current = null;
      resolve(found);
    }
  }, [options]);

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
      let success = optionsRef.current?.onScrollToMessage?.(messageId) ?? false;

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

      // 3. Если сообщение выше в истории и есть возможность догрузить (до 5 страниц)
      const initialOpts = optionsRef.current;
      if (initialOpts?.loadOlder && initialOpts?.hasMoreOlder) {
        showToast(
          'info',
          t('loadingOlderForJump', 'Загрузка истории для перехода к сообщению...')
        );

        pendingJumpTargetRef.current = messageId;
        let attempts = 0;

        try {
          while (attempts < MAX_LOAD_OLDER_ATTEMPTS) {
            attempts++;

            // Ждем реактивного коммита через эффект списка либо фоллбэк по таймеру
            const waitForUpdate = new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => {
                pendingResolveRef.current = null;
                resolve(optionsRef.current?.onScrollToMessage?.(messageId) ?? false);
              }, 30);

              pendingResolveRef.current = (found) => {
                clearTimeout(timer);
                resolve(found);
              };
            });

            try {
              await optionsRef.current?.loadOlder?.({ isJump: true });
            } catch {
              break;
            }

            const found = await waitForUpdate;
            if (found) {
              applyHighlight(messageId);
              return true;
            }

            if (!optionsRef.current?.hasMoreOlder) {
              break;
            }
          }
        } finally {
          pendingJumpTargetRef.current = null;
          pendingResolveRef.current = null;
        }
      }

      showToast('info', t('messageNotInHistory', 'Сообщение находится выше в истории'));
      return false;
    },
    [applyHighlight, showToast, t]
  );

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  return { jumpToMessage };
}

import { showToast } from '@/shared/ui';
import { useChatUiStore } from '@/entities/chat';
import { MESSAGES_PAGE_SIZE } from '@/entities/message';
import { services } from '@/services/serviceContainer';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const HIGHLIGHT_DURATION_MS = 1800;
/** Сколько страниц догружать, если позицию сообщения узнать не удалось. */
const MAX_LOAD_OLDER_ATTEMPTS = 5;
/** Потолок даже по позиции: 400 страниц по 50 — двадцать тысяч сообщений. */
const MAX_LOAD_OLDER_BY_POSITION = 400;

interface IUseJumpToMessageOptions {
  /** Функция скролла к сообщению (например, через виртуализатор) */
  onScrollToMessage?: (messageId: string) => boolean;
  /** Функция подгрузки более старых страниц истории */
  loadOlder?: (options?: { isJump?: boolean }) => Promise<void> | void;
  /** Флаг наличия более старых страниц */
  hasMoreOlder?: boolean;
  /**
   * Чат ленты: по нему сервер скажет позицию сообщения (#842), и лента
   * догрузится ровно до него, а не на пять страниц наугад.
   */
  chatId?: string;
}

/**
 * Хук навигации и плавного перехода к сообщению по ID (при клике на цитату или закрепление)
 * с акцентной подсветкой и обработкой незагруженных страниц истории.
 */
export function useJumpToMessage(options?: IUseJumpToMessageOptions) {
  const { t } = useTranslation();
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

      // 3. Если сообщение выше в истории — догрузить до него (по позиции с сервера)
      const initialOpts = optionsRef.current;
      if (initialOpts?.loadOlder && initialOpts?.hasMoreOlder) {
        pendingJumpTargetRef.current = messageId;
        let attempts = 0;
        // Позиция — сколько сообщений новее: столько страниц и нужно
        // (плюс одна на сдвиг, пока шёл запрос). Не узнали — как раньше.
        let maxAttempts = MAX_LOAD_OLDER_ATTEMPTS;
        if (initialOpts.chatId) {
          try {
            const position = await services.messageService.getMessagePosition(
              initialOpts.chatId,
              messageId
            );
            maxAttempts = Math.min(
              MAX_LOAD_OLDER_BY_POSITION,
              Math.ceil((position + 1) / MESSAGES_PAGE_SIZE) + 1
            );
          } catch {
            // Сообщение удалено или сеть недоступна — догружаем как раньше.
          }
        }

        try {
          while (attempts < maxAttempts) {
            attempts++;

            try {
              await optionsRef.current?.loadOlder?.({ isJump: true });
            } catch {
              break;
            }

            // Проверяем сразу после разрешения сетевого запроса
            let found = optionsRef.current?.onScrollToMessage?.(messageId) ?? false;

            // Если реактивный коммит ленты ещё в процессе, ждём эффект списка или следующий тик
            if (!found) {
              found = await new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => {
                  pendingResolveRef.current = null;
                  resolve(optionsRef.current?.onScrollToMessage?.(messageId) ?? false);
                }, 40);

                pendingResolveRef.current = (res) => {
                  clearTimeout(timer);
                  resolve(res);
                };
              });
            }

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

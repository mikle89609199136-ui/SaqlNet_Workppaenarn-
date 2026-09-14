import { showToast } from '@/shared/ui';
import { describeApiError } from '@/shared/api';
import { CHAT_ROLES, CHAT_TYPES } from '@/shared/config';
import { chatQuery } from '@/queries/chat/threadQueries';
import { dropThreadMessage, patchThreadMessage } from '@/queries/chat/threadCacheActions';
import { beginReactionChange, endReactionChange } from '@/queries/chat/pendingReactions';
import { services } from '@/services/serviceContainer';
import { applyReaction } from '@/entities/message';
import { translateText } from '@/services/translatorApi';
import { hasTranslatorConsent, rememberTranslatorConsent } from '@/services/translatorConsent';
import { useChatUiStore, useProfileStore } from '@/store';
import { removeOutboxItem } from '@/store/outbox';
import { setComposerText } from '@/shared/lib/setComposerText';
import type { IMessageDto } from '@/types';
import { sortMessagesChronologically } from '@/shared/lib/sortMessagesChronologically';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

interface Props {
  setIsForwardModalOpen: Dispatch<SetStateAction<boolean>>;
  draftRef?: RefObject<HTMLInputElement | null>;
}

/**
 * Сколько раз нажимали на реакции каждого сообщения.
 *
 * Ответы сервера приходят в любом порядке, и ответ на первое нажатие,
 * опоздав, возвращал бы картину, которую человек уже отменил вторым: два
 * быстрых выбора подряд заканчивались прыжком к первому эмодзи. Ответ
 * применяется, только если с момента отправки не было нового нажатия.
 *
 * Счёт ведётся вне React намеренно. Меню действий размонтируется сразу
 * после нажатия, унося с собой всё, что жило в его состоянии, — счётчик
 * в `useRef` обнулялся бы к каждому следующему нажатию и не защищал ни от
 * чего.
 */
const reactionAttempts = new Map<string, number>();

export const useMessageActions = ({ setIsForwardModalOpen, draftRef }: Props) => {
  const currentUser = useProfileStore((state) => state.user);
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { t } = useTranslation();
  const [translatingIds, setTranslatingIds] = useState(new Set());

  const queryClient = useQueryClient();
  const { data: chat } = useQuery(chatQuery(chatId));
  const chatType = chat?.type;
  const chatRole = chat?.role;
  const setError = useChatUiStore((state) => state.setError);
  const editingMessage = useChatUiStore((state) => state.editingMessage);
  const setEditingMessage = useChatUiStore((state) => state.setEditingMessage);
  const replyToMessage = useChatUiStore((state) => state.replyToMessage);
  const setReplyToMessage = useChatUiStore((state) => state.setReplyToMessage);
  const selectedMessages = useChatUiStore((state) => state.selectedMessages);
  const setSelectedMessages = useChatUiStore((state) => state.setSelectedMessages);
  const selectionMode = useChatUiStore((state) => state.selectionMode);
  const setSelectionMode = useChatUiStore((state) => state.setSelectionMode);
  const translations = useChatUiStore((state) => state.translations);
  const setTranslations = useChatUiStore((state) => state.setTranslations);
  const setActionMenu = useChatUiStore((state) => state.setActionMenu);

  const handleTranslateMessage = async (message: IMessageDto) => {
    if (translations[message.id]) {
      setTranslations((prev) => {
        const next = { ...prev };
        delete next[message.id];
        return next;
      });
      return;
    }

    // Перевод отправляет расшифрованный текст в Google. Обещать сквозное
    // шифрование и молча делать это — обман, поэтому спрашиваем. Один раз
    // на аккаунт: вопрос на каждое сообщение приучил бы жать «да» не читая.
    if (!hasTranslatorConsent()) {
      const agreed = window.confirm(
        t('translatorConsent', 'Текст сообщения будет отправлен в Google для перевода. Продолжить?')
      );

      if (!agreed) return;

      rememberTranslatorConsent();
    }

    setTranslatingIds((prev) => new Set(prev).add(message.id));
    try {
      const { translatedText, targetLanguage, detectedSourceLang } = await translateText(
        message.content
      );

      if (detectedSourceLang && detectedSourceLang === targetLanguage) {
        showToast('success', t('alreadySameLanguage', 'Сообщение уже на вашем языке'));
        return;
      }

      setTranslations((prev) => ({ ...prev, [message.id]: translatedText }));
    } catch (err) {
      showToast('error', t('translateError', 'Не удалось перевести сообщение'));
    } finally {
      setTranslatingIds((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  };

  const handleDelete = async (message: IMessageDto) => {
    try {
      if (selectionMode) {
        // Удалять можно только свои сообщения — чужие отсеиваются заранее,
        // иначе в набор попадали undefined вместо идентификаторов.
        const own = selectedMessages.filter((item) => item.senderId === currentUser?.id);

        const serverMessages = own.filter((item) => !item.tempId && !item.id.startsWith('temp-'));
        const outboxMessages = own.filter(
          (item) => Boolean(item.tempId) || item.id.startsWith('temp-')
        );

        outboxMessages.forEach((item) => {
          const id = item.tempId || item.id;
          removeOutboxItem(id);
          dropThreadMessage(queryClient, chatId, id);
        });

        if (serverMessages.length > 0) {
          // Именно возврат промиса делает ожидание настоящим: без него
          // Promise.all завершался мгновенно, а отказы становились
          // необработанными и не доходили до catch.
          await Promise.all(
            serverMessages.map((item) => services.messageService.deleteMessage(item.id))
          );
          serverMessages.forEach((item) => dropThreadMessage(queryClient, chatId, item.id));
        }

        handleCancelSelection();
      }

      if (!selectionMode) {
        if (message.senderId !== currentUser?.id) return;
        const id = message.tempId || message.id;
        const isOutbox = Boolean(message.tempId) || message.id.startsWith('temp-');

        if (isOutbox) {
          removeOutboxItem(id);
          dropThreadMessage(queryClient, chatId, id);
        } else {
          await services.messageService.deleteMessage(message.id);
          dropThreadMessage(queryClient, chatId, message.id);
        }

        if (editingMessage?.id === message.id) {
          setEditingMessage(null);
          setComposerText(draftRef?.current ?? null, '');
        }
        if (replyToMessage?.id === message.id) {
          setReplyToMessage(null);
        }
      }
      setError('');
    } catch (err: unknown) {
      setError(
        describeApiError(err, t, t('messageDeleteError', 'Не удалось удалить сообщение(я)'))
      );
    }
  };

  /**
   * Поставить, снять или заменить реакцию.
   *
   * Сервер переключает сам: та же реакция от того же человека снимается,
   * новая ставится. Прежде клиент до него не доходил — при любой уже
   * поставленной реакции он молча возвращался, и шесть эмодзи в меню
   * становились мёртвыми: ни снять, ни поменять.
   *
   * Без подписки реакция одна: выбор другого эмодзи сначала снимает
   * прежний. С подпиской они копятся — это и есть всё её отличие здесь.
   */
  const handleReact = async (message: IMessageDto, emoji: string) => {
    const previous = message.reactions ?? [];
    const mine = previous.find((reaction) => reaction.myReaction);
    const allowMultiple = Boolean(currentUser?.isPremium);

    const attempt = (reactionAttempts.get(message.id) ?? 0) + 1;
    reactionAttempts.set(message.id, attempt);
    const isLatest = () => reactionAttempts.get(message.id) === attempt;

    // Пока идёт замена, вести сервера по этому сообщению не применяются:
    // между двумя запросами он рассылает состояние «реакции нет».
    beginReactionChange(message.id);

    /* Результат показывается сразу, до ответа сервера: реакция — жест
       мгновенный, и ожидание на ней заметно сильнее, чем где-либо ещё.
       При замене запросов и вовсе два, и ждать оба значит смотреть, как
       эмодзи меняются по очереди. */
    patchThreadMessage(queryClient, chatId, message.id, {
      reactions: applyReaction(previous, emoji, { allowMultiple }),
    });

    try {
      // Своя же реакция снимается одним запросом: сервер переключает сам.
      if (mine && mine.emoji !== emoji && !allowMultiple) {
        await services.messageService.reactToMessage(message.id, mine.emoji);
      }

      const result = await services.messageService.reactToMessage(message.id, emoji);

      // Пока ходили на сервер, человек мог выбрать другое — тогда ответ
      // устарел и показывать его нельзя.
      if (!isLatest()) return;

      patchThreadMessage(queryClient, chatId, message.id, { reactions: result.reactions || [] });
      setError('');
    } catch (err: any) {
      // Откат тоже только для последнего нажатия: иначе неудача старого
      // запроса стёрла бы выбор, сделанный после него.
      if (!isLatest()) return;

      // Не вышло — возвращаем то, что было: показанное авансом должно
      // исчезнуть, иначе человек уверен, что реакция стоит.
      patchThreadMessage(queryClient, chatId, message.id, { reactions: previous });
      setError(describeApiError(err, t, t('reactionError', 'Не удалось обновить реакцию')));
    } finally {
      if (isLatest()) endReactionChange(message.id);
    }
  };

  const handleUnpinMessage = async (message: IMessageDto) => {
    try {
      if (selectionMode) {
        for (const message of selectedMessages) {
          await services.messageService.unpinMessage(chatId, message.id);
        }
        return;
      }

      await services.messageService.unpinMessage(chatId, message.id);
    } catch (err: any) {
      setError(describeApiError(err, t, t('messageUnpinError', 'Не удалось открепить сообщение')));
      if (
        chatType === CHAT_TYPES.GROUP &&
        chatRole !== CHAT_ROLES.ADMIN &&
        chatRole !== CHAT_ROLES.OWNER
      ) {
        showToast(
          'error',
          t(
            'messageUnpinMemberError',
            'Не удалось открепить сообщение. У вас нет прав администратора.'
          )
        );
        return;
      }

      showToast('error', t('messageUnpinError', 'Не удалось открепить сообщение'));
    }
  };

  const handlePinMessage = async (message: IMessageDto) => {
    try {
      if (selectionMode) {
        for (const message of selectedMessages) {
          await services.messageService.pinMessage(chatId, message.id);
        }
        return;
      }

      await services.messageService.pinMessage(chatId, message.id);
    } catch (err: any) {
      setError(describeApiError(err, t, t('messagePinError', 'Не удалось закрепить сообщение')));
      if (
        chatType === CHAT_TYPES.GROUP &&
        chatRole !== CHAT_ROLES.ADMIN &&
        chatRole !== CHAT_ROLES.OWNER
      ) {
        showToast(
          'error',
          t(
            'messagePinMemberError',
            'Не удалось закрепить сообщение. У вас нет прав администратора.'
          )
        );
        return;
      }

      showToast('error', t('messagePinError', 'Не удалось закрепить сообщение'));
    }
  };

  const startSelection = (message: IMessageDto) => {
    setSelectionMode(true);
    setSelectedMessages([message]);
    setActionMenu(null);
  };

  const handleForward = (message: IMessageDto) => {
    if (selectionMode) {
      setIsForwardModalOpen(true);
      return;
    }

    setSelectedMessages([message]);
    setIsForwardModalOpen(true);
  };

  const handleCloseForwardModal = () => {
    if (selectionMode) {
      setIsForwardModalOpen(false);
      return;
    }

    setSelectedMessages([]);
    setIsForwardModalOpen(false);
  };

  const startReply = (message: IMessageDto) => {
    setReplyToMessage(message);
    setEditingMessage(null);
    if (!draftRef || !draftRef.current) return;
    draftRef.current.focus();
  };

  const startEdit = (message: IMessageDto) => {
    setEditingMessage(message);
    setReplyToMessage(null);
    setComposerText(draftRef?.current ?? null, message.content || '');
    draftRef?.current?.focus();
  };

  const closeMessageActions = () => {
    setActionMenu(null);
  };

  const runMessageAction = (action: any) => {
    action();
    closeMessageActions();
  };

  function handleCopyMessage(message: IMessageDto) {
    if (selectionMode) {
      const sortedMessages = sortMessagesChronologically<IMessageDto>(selectedMessages);

      const allContent = sortedMessages.map((message) => message.content).join('\n');
      navigator.clipboard.writeText(allContent);
      handleCancelSelection();
      return;
    }

    navigator.clipboard.writeText(message.content);
  }

  function handleCancelSelection() {
    setSelectedMessages([]);
    setSelectionMode(false);
  }

  return {
    translatingIds,
    handleTranslateMessage,
    handleDelete,
    handleReact,
    handleUnpinMessage,
    handlePinMessage,
    startSelection,
    handleForward,
    handleCloseForwardModal,
    startReply,
    startEdit,
    closeMessageActions,
    runMessageAction,
    handleCopyMessage,
    handleCancelSelection,
  };
};

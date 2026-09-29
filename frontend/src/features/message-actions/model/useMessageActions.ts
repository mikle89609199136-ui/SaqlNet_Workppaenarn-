import { showToast } from '@/shared/ui';
import { describeApiError } from '@/shared/api';
import { CHAT_ROLES, CHAT_TYPES } from '@/shared/config';
import { chatQuery } from '@/entities/chat';
import {
  applyReaction,
  beginReactionChange,
  dropThreadMessage,
  dropThreadMessages,
  endReactionChange,
  patchThreadMessage,
  removeOutboxItem,
} from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { translateText } from '@/services/translatorApi';
import { hasTranslatorConsent, rememberTranslatorConsent } from '@/services/translatorConsent';
import { useChatUiStore } from '@/entities/chat';
import { sortMessagesChronologically } from '@/shared/lib';
import type { IRichTextInputHandle } from '@/shared/ui';
import type { IMediaItem, IMessageDto } from '@/types';
import { copyImageToClipboard, mediaFileName, saveMediaAs } from './mediaActions';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

interface Props {
  setIsForwardModalOpen: Dispatch<SetStateAction<boolean>>;
  draftRef?: RefObject<IRichTextInputHandle | null>;
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
  const setDeleteTargets = useChatUiStore((state) => state.setDeleteTargets);
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

  /**
   * «Удалить» в меню сообщения или в панели выбора — открывает подтверждение
   * (#840). Удаляет confirmDelete, когда человек выбрал, у кого.
   */
  const handleDelete = (message?: IMessageDto) => {
    const targets = selectionMode ? selectedMessages : message ? [message] : [];
    if (targets.length > 0) setDeleteTargets(targets);
  };

  /**
   * Удаление выбранного: у всех — только когда все свои, иначе у себя.
   * Неотправленные просто убираются из очереди. `false` — не вышло,
   * диалог остаётся открытым.
   */
  const confirmDelete = async (targets: IMessageDto[], forEveryone: boolean) => {
    const isOutbox = (item: IMessageDto) => Boolean(item.tempId) || item.id.startsWith('temp-');
    const sent = targets.filter((item) => !isOutbox(item));

    try {
      if (sent.length > 0) {
        const allOwn = sent.every((item) => item.senderId === currentUser?.id);
        const ids = sent.map((item) => item.id);
        await services.messageService.deleteMessages(chatId, ids, forEveryone && allOwn);
        dropThreadMessages(queryClient, chatId, ids);
      }
    } catch (err: unknown) {
      showToast(
        'error',
        describeApiError(err, t, t('messageDeleteError', 'Не удалось удалить сообщение(я)'))
      );
      return false;
    }

    targets.filter(isOutbox).forEach((item) => {
      const id = item.tempId || item.id;
      removeOutboxItem(id);
      dropThreadMessage(queryClient, chatId, id);
    });

    const removed = new Set(targets.map((item) => item.id));
    if (editingMessage && removed.has(editingMessage.id)) {
      setEditingMessage(null);
      draftRef?.current?.clear();
    }
    if (replyToMessage && removed.has(replyToMessage.id)) setReplyToMessage(null);
    if (selectionMode) handleCancelSelection();
    setError('');
    return true;
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
    // С форматированием: правка заменяет его целиком (#656).
    draftRef?.current?.setValue({
      text: message.content || '',
      entities: message.entities ?? [],
    });
    draftRef?.current?.focus();
  };

  const closeMessageActions = () => {
    setActionMenu(null);
  };

  const runMessageAction = (action: any) => {
    action();
    closeMessageActions();
  };

  /**
   * Текст в буфер обмена (#655). В режиме выбора — все отмеченные по
   * порядку. Результат подтверждается уведомлением: без него не понять,
   * сработало ли, а буфер может и отказать (нет разрешения, не HTTPS).
   */
  async function handleCopyMessage(message: IMessageDto) {
    const text = selectionMode
      ? sortMessagesChronologically<IMessageDto>(selectedMessages)
          .map((item) => item.content)
          .filter(Boolean)
          .join('\n')
      : message.content;
    if (selectionMode) handleCancelSelection();

    try {
      await navigator.clipboard.writeText(text);
      showToast('success', t('messageActions.copied', 'Скопировано'));
    } catch {
      showToast('error', t('format.copyFailed', 'Не удалось скопировать'));
    }
  }

  /** Картинку из сообщения — в буфер как PNG (#655). */
  async function handleCopyImage(message: IMediaItem) {
    if (!message.mediaUrl) return;
    try {
      await copyImageToClipboard(message.mediaUrl);
      showToast('success', t('messageActions.imageCopied', 'Изображение скопировано'));
    } catch {
      showToast('error', t('format.copyFailed', 'Не удалось скопировать'));
    }
  }

  /**
   * «Сохранить как…» (#655): скачать уже расшифрованное вложение под
   * исходным именем. Дальше — окно загрузки самого браузера; «сохранено»
   * не пишем: человек может отменить сохранение в нём.
   */
  function handleSaveMedia(message: IMediaItem) {
    if (!message.mediaUrl) return;
    try {
      saveMediaAs(message.mediaUrl, mediaFileName(message));
    } catch {
      showToast('error', t('messageActions.saveFailed', 'Не удалось сохранить файл'));
    }
  }

  function handleCancelSelection() {
    setSelectedMessages([]);
    setSelectionMode(false);
  }

  return {
    translatingIds,
    handleTranslateMessage,
    handleDelete,
    confirmDelete,
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
    handleCopyImage,
    handleSaveMedia,
    handleCancelSelection,
  };
};

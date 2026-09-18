import { useEncryptionState } from '@/features/chat-encryption';
import { useTypingIndicator } from '@/features/typing-indicator';
import {
  useAttachmentPicker,
  useComposerSendMessage,
  useComposerShortcuts,
} from '@/features/send-message';
import { clearDraft, readDraft, writeDraft } from '@/entities/chat';
import type { IEncryptionState } from '@/crypto/encryptionStatus';
import type { TFunction } from 'i18next';
import type { IPendingAttachment } from '@/types';
import { cn } from '@/shared/lib';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AttachmentControl } from './AttachmentControl';
import { AttachmentPreview } from './AttachmentPreview';
import { ComposerContextBanner } from './ComposerContextBanner';
import { ComposerForm } from './ComposerForm';
import { ComposerRow } from './ComposerRow';

/** Что написано в поле ввода, пока сообщение не набрано. */
function composerPlaceholder(encryption: IEncryptionState, t: TFunction): string {
  if (encryption.status === 'preparing') {
    return t('encryptionPreparing', 'Готовим шифрование...');
  }

  if (encryption.status === 'unavailable') {
    return t('encryptionUnavailable', 'Шифрование недоступно');
  }

  if (encryption.unreachable.length > 0) {
    return t('peerNeedsUpdate', 'Собеседник прочтёт после обновления приложения');
  }

  return t('messagePlaceholder', 'Сообщение...');
}

interface Props {
  selectionMode: boolean;
  pendingAttachment: IPendingAttachment | null;
  bottomRef: RefObject<HTMLDivElement | null>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  draftRef: RefObject<HTMLInputElement | null>;
  setPendingAttachment: Dispatch<SetStateAction<IPendingAttachment | null>>;
  setPhotoEditorFile: Dispatch<SetStateAction<File | null>>;
  setOpenedImage?: Dispatch<SetStateAction<string | null>>;
}

export const ChatThreadComposer = ({
  selectionMode,
  pendingAttachment,
  setPendingAttachment,
  bottomRef,
  attachmentInputRef,
  draftRef,
  setPhotoEditorFile,
  setOpenedImage,
}: Props) => {
  const { t } = useTranslation();

  const { chatId = '' } = useParams<{ chatId: string }>();

  // Пока ключ чата не готов, отправлять нечем: сообщение ушло бы открытым
  // текстом или не ушло вовсе, и человеку лучше узнать об этом до того,
  // как он его наберёт.
  const encryption = useEncryptionState(chatId);

  // Текст живёт в самом поле, а не в состоянии React: иначе каждый символ
  // перерисовывал бы композер со всеми его частями. Здесь хранится
  // единственное, от чего зависит вид, — есть ли что отправлять.
  const [hasText, setHasText] = useState(() => readDraft(chatId).length > 0);

  const formRef = useRef<HTMLFormElement | null>(null);

  /* Возврат в чат: поле заполняется тем, что осталось недописанным.

     Разделено надвое намеренно. Признак «в поле что-то есть» — состояние
     React, и обновляется сравнением во время отрисовки: эффект успел бы
     нарисовать кадр, где кнопка отправки уже активна от прежнего чата.
     А запись в само поле — работа с DOM, ей место в эффекте. */
  const [seenChatId, setSeenChatId] = useState(chatId);

  if (chatId !== seenChatId) {
    setSeenChatId(chatId);
    setHasText(readDraft(chatId).length > 0);
  }

  useEffect(() => {
    if (draftRef.current) draftRef.current.value = readDraft(chatId);
  }, [chatId, draftRef]);

  const sendTyping = useTypingIndicator();
  const { cancelComposerMode } = useComposerShortcuts(draftRef, formRef);
  const { handleAttachmentChange, removePendingAttachment } = useAttachmentPicker({
    attachmentInputRef,
    setPendingAttachment,
    setPhotoEditorFile,
  });
  const { handleSubmit, isSending } = useComposerSendMessage({
    attachmentInputRef,
    bottomRef,
    draftRef,
    pendingAttachment,
    selectionMode,
    setPendingAttachment,
  });

  function handleDraftChange(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;

    // Пустое поле — не черновик: пометка в списке чатов должна пропасть
    // сразу, а не через полсекунды после стирания последнего символа.
    if (text) writeDraft(chatId, text);
    else clearDraft(chatId);

    // Перерисовка только на переходе «пусто ↔ есть текст»: остальные
    // символы состояние не трогают.
    setHasText(text.trim().length > 0);
    sendTyping();
  }

  return (
    <ComposerForm onSubmit={handleSubmit} ref={formRef}>
      <ComposerContextBanner onCancel={cancelComposerMode} />
      <AttachmentPreview
        attachment={pendingAttachment}
        onEdit={setPhotoEditorFile}
        onOpenImage={setOpenedImage ? (url) => setOpenedImage(url) : undefined}
        onRemove={removePendingAttachment}
      />
      <ComposerRow>
        <AttachmentControl
          isSending={isSending}
          inputRef={attachmentInputRef}
          onChange={handleAttachmentChange}
        />

        <input
          ref={draftRef}
          aria-label={t('message', 'Сообщение')}
          className="thread-composer-input min-h-11"
          disabled={encryption.status !== 'ready'}
          onChange={handleDraftChange}
          placeholder={composerPlaceholder(encryption, t)}
        />

        <button
          aria-label={t('sendMessage', 'Отправить сообщение')}
          className={cn('thread-composer-action-btn', hasText && 'is-active')}
          disabled={encryption.status !== 'ready'}
          type="submit"
        >
          <svg
            fill="none"
            height="18"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
            width="18"
          >
            <line x1="22" x2="11" y1="2" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </ComposerRow>
    </ComposerForm>
  );
};

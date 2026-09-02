import {
  useAttachmentPicker,
  useComposerSendMessage,
  useComposerShortcuts,
  useEncryptionState,
  useTypingIndicator,
} from '@/hooks';
import { clearDraft, readDraft, writeDraft } from '@/store/chatDrafts';
import type { IEncryptionState } from '@/crypto/encryptionStatus';
import type { TFunction } from 'i18next';
import type { IPendingAttachment } from '@/types';
import { cn } from '@/utils';
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
import {
  AttachmentControl,
  AttachmentPreview,
  ComposerContextBanner,
  ComposerForm,
  ComposerRow,
} from '@/components/ui';

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
}

export const ChatThreadComposer = ({
  selectionMode,
  pendingAttachment,
  setPendingAttachment,
  bottomRef,
  attachmentInputRef,
  draftRef,
  setPhotoEditorFile,
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

  // Возврат в чат: поле заполняется тем, что осталось недописанным.
  useEffect(() => {
    const saved = readDraft(chatId);

    if (draftRef.current) draftRef.current.value = saved;
    setHasText(saved.length > 0);
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
      <AttachmentPreview attachment={pendingAttachment} onRemove={removePendingAttachment} />
      <ComposerRow>
        <AttachmentControl
          isSending={isSending}
          inputRef={attachmentInputRef}
          onChange={handleAttachmentChange}
        />

        <input
          ref={draftRef}
          aria-label={t('message', 'Сообщение')}
          className="thread-composer-input"
          disabled={encryption.status !== 'ready'}
          onChange={handleDraftChange}
          placeholder={composerPlaceholder(encryption, t)}
        />

        <div className="thread-composer-submit-wrap">
          <button
            className={cn(
              'thread-composer-action-btn thread-send-btn',
              (hasText || pendingAttachment) && 'is-visible'
            )}
            disabled={(!hasText && !pendingAttachment) || isSending}
            type="submit"
          >
            {isSending ? (
              <span className="thread-sending-spinner">⏳</span>
            ) : (
              <svg
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <line x1="22" x2="11" y1="2" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>

          <button
            aria-label={t('voiceMessage', 'Голосовое сообщение')}
            className={cn(
              'thread-composer-action-btn thread-mic-btn',
              !hasText && !pendingAttachment && 'is-visible'
            )}
            type="button"
          >
            <svg
              fill="none"
              height="20"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="20"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="23" />
              <line x1="8" x2="16" y1="23" y2="23" />
            </svg>
          </button>
        </div>
      </ComposerRow>
    </ComposerForm>
  );
};

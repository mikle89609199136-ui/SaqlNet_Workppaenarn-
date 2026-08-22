import {
  useAttachmentPicker,
  useComposerSendMessage,
  useComposerShortcuts,
  useTypingIndicator,
} from '@/hooks';
import { WebSocketClient } from '@/services';
import { useChatStore } from '@/store';
import type { IPendingAttachment } from '@/types';
import { cn } from '@/utils';
import {
  useRef,
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AttachmentControl,
  AttachmentPreview,
  ComposerContextBanner,
  ComposerForm,
  ComposerRow,
} from '../ui';

interface Props {
  selectionMode: boolean;
  socket: WebSocketClient;
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

  const draft = useChatStore((state) => state.draft);
  const setDraft = useChatStore((state) => state.setDraft);

  const formRef = useRef<HTMLFormElement | null>(null);

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
    pendingAttachment,
    selectionMode,
    setPendingAttachment,
  });

  function handleDraftChange(event: ChangeEvent<HTMLInputElement>) {
    setDraft(event.target.value);
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
          onChange={handleDraftChange}
          placeholder={t('messagePlaceholder', 'Сообщение...')}
          value={draft}
        />

        <div className="thread-composer-submit-wrap">
          <button
            className={cn(
              'thread-composer-action-btn thread-send-btn',
              (draft.trim() || pendingAttachment) && 'is-visible'
            )}
            disabled={(!draft.trim() && !pendingAttachment) || isSending}
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
              !draft.trim() && !pendingAttachment && 'is-visible'
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

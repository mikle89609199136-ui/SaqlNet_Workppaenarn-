import { useChatStore } from '@/store';
import type { ChangeEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  isSending: boolean;
}

export const AttachmentControl = ({ inputRef, onChange, isSending }: Props) => {
  const { t } = useTranslation();
  const editingMessage = useChatStore((state) => state.editingMessage);

  return (
    <>
      <input
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
        aria-label={t('attachFile', 'Прикрепить файл')}
        className="thread-file-input"
        onChange={onChange}
        ref={inputRef}
        type="file"
      />
      <button
        aria-label={t('attachFile', 'Прикрепить файл')}
        className="thread-composer-action-btn thread-attach-button"
        disabled={isSending || Boolean(editingMessage)}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        <svg
          fill="none"
          height="22"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="22"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
    </>
  );
};

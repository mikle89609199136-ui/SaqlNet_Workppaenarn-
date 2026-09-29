import { useChatUiStore } from '@/entities/chat';
import type { IPendingAttachment } from '@/types';
import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

interface Params {
  pendingAttachments: IPendingAttachment[];
  setPendingAttachments: Dispatch<SetStateAction<IPendingAttachment[]>>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
}

/** Больше за раз — не приложить: как альбом в Telegram. */
export const MAX_PENDING_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function getMediaMessageType(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

let nextAttachmentId = 0;

export function createPendingAttachment(file: File): IPendingAttachment {
  nextAttachmentId += 1;
  return { id: `attachment-${nextAttachmentId}`, file, type: getMediaMessageType(file.type) };
}

/**
 * Выбор вложений. Выбранное добавляется к уже приложенному, а не
 * заменяет его: можно выбрать несколько файлов сразу или добавлять по
 * одному — как в макете (#821). Больше 100 МБ и сверх десяти — не
 * прикладывается, с объяснением.
 */
export function useAttachmentPicker({
  pendingAttachments,
  setPendingAttachments,
  attachmentInputRef,
}: Params) {
  const { t } = useTranslation();
  const setEditingMessage = useChatUiStore((state) => state.setEditingMessage);
  const setError = useChatUiStore((state) => state.setError);

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Сброс сразу: тот же файл можно выбрать ещё раз.
    event.target.value = '';
    if (files.length === 0) return;

    const fitting = files.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
    const room = Math.max(0, MAX_PENDING_ATTACHMENTS - pendingAttachments.length);
    const added = fitting.slice(0, room).map(createPendingAttachment);

    let error = '';
    if (fitting.length > room) {
      error = t('attachmentsLimit', 'Можно приложить не больше {{max}} файлов', {
        max: MAX_PENDING_ATTACHMENTS,
      });
    } else if (fitting.length < files.length) {
      error = t('attachmentTooLarge', 'Файл слишком большой. Максимальный размер — 100 МБ.');
    }

    if (added.length > 0) setPendingAttachments((current) => [...current, ...added]);
    setEditingMessage(null);
    setError(error);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  return { handleAttachmentChange, removePendingAttachment };
}

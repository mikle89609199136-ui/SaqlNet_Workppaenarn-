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

export function formatScreenshotName(date: Date = new Date(), mimeType = 'image/png'): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  let ext = 'png';
  if (mimeType === 'image/jpeg') ext = 'jpg';
  else if (mimeType === 'image/webp') ext = 'webp';
  else if (mimeType === 'image/gif') ext = 'gif';

  return `Снимок ${YYYY}-${MM}-${DD} ${HH}-${mm}-${ss}.${ext}`;
}

export function normalizePastedFile(file: File, now: Date = new Date()): File {
  const name = file.name.trim();
  const isGenericImage =
    file.type.startsWith('image/') &&
    (!name || name === 'image.png' || name === 'blob' || name === 'image');
  if (isGenericImage) {
    const newName = formatScreenshotName(now, file.type);
    return new File([file], newName, { type: file.type, lastModified: file.lastModified });
  }
  return file;
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

  function addFiles(files: File[]): boolean {
    if (files.length === 0) return false;

    const normalized = files.map((file) => normalizePastedFile(file));
    const fitting = normalized.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
    const room = Math.max(0, MAX_PENDING_ATTACHMENTS - pendingAttachments.length);
    const added = fitting.slice(0, room).map(createPendingAttachment);

    let error = '';
    if (fitting.length > room) {
      error = t('attachmentsLimit', 'Можно приложить не больше {{max}} файлов', {
        max: MAX_PENDING_ATTACHMENTS,
      });
    } else if (fitting.length < normalized.length) {
      error = t('attachmentTooLarge', 'Файл слишком большой. Максимальный размер — 100 МБ.');
    }

    if (added.length > 0) {
      setPendingAttachments((current) => [...current, ...added]);
    }
    setEditingMessage(null);
    setError(error);

    return added.length > 0;
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Сброс сразу: тот же файл можно выбрать ещё раз.
    event.target.value = '';
    addFiles(files);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  return { addFiles, handleAttachmentChange, removePendingAttachment };
}

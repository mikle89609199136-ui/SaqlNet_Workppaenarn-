import { useChatStore } from '@/store';
import type { IPendingAttachment } from '@/types';
import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

interface Params {
  setPendingAttachment: Dispatch<SetStateAction<IPendingAttachment | null>>;
  setPhotoEditorFile: Dispatch<SetStateAction<File | null>>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
}

function getMediaMessageType(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

export function useAttachmentPicker({
  setPendingAttachment,
  setPhotoEditorFile,
  attachmentInputRef,
}: Params) {
  const { t } = useTranslation();
  const setEditingMessage = useChatStore((state) => state.setEditingMessage);
  const setError = useChatStore((state) => state.setError);

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      setError(t('attachmentTooLarge', 'Файл слишком большой. Максимальный размер — 100 МБ.'));
      event.target.value = '';
      return;
    }

    if (file.type.startsWith('image/')) {
      setPhotoEditorFile(file);
      setEditingMessage(null);
      setError('');
      return;
    }

    setPendingAttachment({ file, type: getMediaMessageType(file.type) });
    setEditingMessage(null);
    setError('');
  }

  function removePendingAttachment() {
    setPendingAttachment(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  return { handleAttachmentChange, removePendingAttachment };
}

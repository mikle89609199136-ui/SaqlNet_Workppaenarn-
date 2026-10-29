import { useChatUiStore } from '@/entities/chat';
import type { IPendingAttachment } from '@/types';
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';

interface Params {
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  /** Файл, открытый в редакторе, — одно из вложений композера. */
  photoEditorFile: File | null;
  setPhotoEditorFile: Dispatch<SetStateAction<File | null>>;
  setPendingAttachments: Dispatch<SetStateAction<IPendingAttachment[]>>;
}

export function usePhotoEditor({
  attachmentInputRef,
  photoEditorFile,
  setPhotoEditorFile,
  setPendingAttachments,
}: Params) {
  const setEditingMessage = useChatUiStore((state) => state.setEditingMessage);
  const setError = useChatUiStore((state) => state.setError);

  const resetAttachmentInput = useCallback(() => {
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }, [attachmentInputRef]);

  const closePhotoEditor = useCallback(() => {
    setPhotoEditorFile(null);
    resetAttachmentInput();
  }, [setPhotoEditorFile, resetAttachmentInput]);

  // Сохранённый снимок встаёт на место того вложения, которое открыли, —
  // остальные остаются как были.
  const savePhotoEditor = useCallback(
    (file: File) => {
      setPendingAttachments((current) =>
        current.map((attachment) =>
          // Редактор уже оптимизировал размер, включая PNG fallback; повторное
          // пересжатие при отправке могло бы потерять альфу.
          attachment.file === photoEditorFile
            ? { ...attachment, file, type: 'image', optimizeImage: false }
            : attachment
        )
      );
      setPhotoEditorFile(null);
      setEditingMessage(null);
      setError('');
      resetAttachmentInput();
    },
    [
      photoEditorFile,
      setPendingAttachments,
      setPhotoEditorFile,
      setEditingMessage,
      setError,
      resetAttachmentInput,
    ]
  );

  return { closePhotoEditor, savePhotoEditor };
}

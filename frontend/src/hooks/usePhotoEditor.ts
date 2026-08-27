import { useChatUiStore } from '@/store';
import type { IPendingAttachment } from '@/types';
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';

interface Params {
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  setPhotoEditorFile: Dispatch<SetStateAction<File | null>>;
  setPendingAttachment: Dispatch<SetStateAction<IPendingAttachment | null>>;
}

export function usePhotoEditor({
  attachmentInputRef,
  setPhotoEditorFile,
  setPendingAttachment,
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

  const savePhotoEditor = useCallback(
    (file: File) => {
      setPendingAttachment({ file, type: 'image' });
      setPhotoEditorFile(null);
      setEditingMessage(null);
      setError('');
      resetAttachmentInput();
    },
    [setPendingAttachment, setPhotoEditorFile, setEditingMessage, setError, resetAttachmentInput]
  );

  return { closePhotoEditor, savePhotoEditor };
}

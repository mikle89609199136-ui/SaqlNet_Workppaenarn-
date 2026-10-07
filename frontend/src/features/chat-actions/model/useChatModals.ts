import { useState } from 'react';
import type { IPendingAttachment } from '@/types';

export function useChatModals() {
  const [pendingAttachments, setPendingAttachments] = useState<IPendingAttachment[]>([]);
  const [photoEditorFile, setPhotoEditorFile] = useState<File | null>(null);
  const [openedImage, setOpenedImage] = useState<string | null>(null);
  const [isPinnedMessagesOpen, setPinnedMessagesOpen] = useState(false);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);

  return {
    pendingAttachments,
    setPendingAttachments,
    photoEditorFile,
    setPhotoEditorFile,
    openedImage,
    setOpenedImage,
    isPinnedMessagesOpen,
    setPinnedMessagesOpen,
    isForwardModalOpen,
    setIsForwardModalOpen,
  };
}

import { useState } from 'react';
import type { IPendingAttachment } from '@/types';

export function useChatModals() {
  const [pendingAttachment, setPendingAttachment] = useState<IPendingAttachment | null>(null);
  const [photoEditorFile, setPhotoEditorFile] = useState<File | null>(null);
  const [openedImage, setOpenedImage] = useState<string | null>(null);
  const [isPinnedMessagesOpen, setPinnedMessagesOpen] = useState(false);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);

  return {
    pendingAttachment,
    setPendingAttachment,
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

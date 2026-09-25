import { useState } from 'react';
import type { IPendingAttachment } from '@/entities/chat';

export function useChatModals() {
  const [pendingAttachment, setPendingAttachment] = useState<IPendingAttachment | null>(null);
  const [photoEditorFile, setPhotoEditorFile] = useState<File | null>(null);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [openedImage, setOpenedImage] = useState<string | null>(null);
  const [isPinnedMessagesOpen, setPinnedMessagesOpen] = useState(false);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);

  return {
    pendingAttachment,
    setPendingAttachment,
    photoEditorFile,
    setPhotoEditorFile,
    isGroupInfoOpen,
    setIsGroupInfoOpen,
    openedImage,
    setOpenedImage,
    isPinnedMessagesOpen,
    setPinnedMessagesOpen,
    isForwardModalOpen,
    setIsForwardModalOpen,
  };
}

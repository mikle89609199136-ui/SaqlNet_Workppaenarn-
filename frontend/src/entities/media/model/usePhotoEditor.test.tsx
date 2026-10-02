import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { IPendingAttachment } from '@/types';
import { usePhotoEditor } from './usePhotoEditor';

/* Фоторедактор при нескольких вложениях (#171): отредактированное фото
   встаёт на место своего оригинала, остальные не трогаются. */
describe('сохранение из фоторедактора', () => {
  it('заменяет только то вложение, которое открыли', () => {
    const first = new File(['1'], 'first.png', { type: 'image/png' });
    const second = new File(['2'], 'second.png', { type: 'image/png' });
    const edited = new File(['e'], 'edited.png', { type: 'image/png' });
    const attachmentInputRef = { current: document.createElement('input') };

    const { result } = renderHook(() => {
      const [pendingAttachments, setPendingAttachments] = useState<IPendingAttachment[]>([
        { id: 'a1', file: first, type: 'image' },
        { id: 'a2', file: second, type: 'image' },
      ]);
      const [photoEditorFile, setPhotoEditorFile] = useState<File | null>(second);
      return {
        pendingAttachments,
        photoEditorFile,
        ...usePhotoEditor({
          attachmentInputRef,
          photoEditorFile,
          setPhotoEditorFile,
          setPendingAttachments,
        }),
      };
    });

    act(() => result.current.savePhotoEditor(edited));

    expect(result.current.pendingAttachments).toEqual([
      { id: 'a1', file: first, type: 'image' },
      { id: 'a2', file: edited, type: 'image' },
    ]);
    expect(result.current.photoEditorFile).toBeNull();
  });
});

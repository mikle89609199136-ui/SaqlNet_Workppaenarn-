import { DEFAULT_CROP, DEFAULT_FILTERS } from '@/consts';
import type { IEditorState } from '@/types';
import { cloneEditorState } from '@/utils';
import { useCallback, useState } from 'react';

export function usePhotoEditorHistory(file: File | null, isReady: boolean) {
  const [history, setHistory] = useState<IEditorState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyForFile, setHistoryForFile] = useState<File | null>(null);

  if (isReady && file && historyForFile !== file) {
    const initial: IEditorState = {
      filters: DEFAULT_FILTERS,
      rotation: 0,
      flipX: 1,
      flipY: 1,
      crop: DEFAULT_CROP,
      cropRatio: null,
      objects: [],
    };
    setHistoryForFile(file);
    setHistory([cloneEditorState(initial)]);
    setHistoryIndex(0);
  }

  const pushHistory = useCallback(
    (snapshot: IEditorState) => {
      const next = history.slice(0, historyIndex + 1);
      next.push(cloneEditorState(snapshot));
      if (next.length > 50) next.shift();
      setHistory(next);
      setHistoryIndex(next.length - 1);
    },
    [history, historyIndex]
  );

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  const undo = useCallback(
    (onApply: (snapshot: IEditorState) => void) => {
      if (historyIndex <= 0) return;
      const target = historyIndex - 1;
      const snapshot = cloneEditorState(history[target]);
      onApply(snapshot);
      setHistoryIndex(target);
    },
    [history, historyIndex]
  );

  const redo = useCallback(
    (onApply: (snapshot: IEditorState) => void) => {
      if (historyIndex >= history.length - 1) return;
      const target = historyIndex + 1;
      const snapshot = cloneEditorState(history[target]);
      onApply(snapshot);
      setHistoryIndex(target);
    },
    [history, historyIndex]
  );

  return {
    history,
    historyIndex,
    pushHistory,
    canUndo,
    canRedo,
    undo,
    redo,
  };
}

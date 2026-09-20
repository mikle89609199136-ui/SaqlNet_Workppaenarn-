import { DEFAULT_CROP, DEFAULT_FILTERS } from '@/shared/config';
import type { IEditorState } from '@/types';
import { cloneEditorState } from '@/shared/lib';
import { useCallback, useState } from 'react';

interface IHistoryState {
  list: IEditorState[];
  index: number;
}

export function usePhotoEditorHistory(file: File | null, isReady: boolean) {
  const [historyState, setHistoryState] = useState<IHistoryState>({ list: [], index: -1 });
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
    setHistoryState({ list: [cloneEditorState(initial)], index: 0 });
  }

  const pushHistory = useCallback((snapshot: IEditorState) => {
    setHistoryState((prev) => {
      const next = prev.list.slice(0, prev.index + 1);
      next.push(cloneEditorState(snapshot));
      if (next.length > 50) next.shift();
      return { list: next, index: next.length - 1 };
    });
  }, []);

  const canUndo = historyState.index > 0;
  const canRedo = historyState.index >= 0 && historyState.index < historyState.list.length - 1;

  const undo = useCallback((onApply: (snapshot: IEditorState) => void) => {
    setHistoryState((prev) => {
      if (prev.index <= 0) return prev;
      const target = prev.index - 1;
      const snapshot = cloneEditorState(prev.list[target]);
      onApply(snapshot);
      return { ...prev, index: target };
    });
  }, []);

  const redo = useCallback((onApply: (snapshot: IEditorState) => void) => {
    setHistoryState((prev) => {
      if (prev.index >= prev.list.length - 1) return prev;
      const target = prev.index + 1;
      const snapshot = cloneEditorState(prev.list[target]);
      onApply(snapshot);
      return { ...prev, index: target };
    });
  }, []);

  return {
    history: historyState.list,
    historyIndex: historyState.index,
    pushHistory,
    canUndo,
    canRedo,
    undo,
    redo,
  };
}

import { useEffect, useState } from 'react';

/**
 * Хук для безопасного создания и освобождения Object URL (Blob/File).
 * Гарантирует вызов URL.revokeObjectURL при смене объекта или размонтировании
 * для предотвращения утечек памяти.
 */
export function useObjectUrl(object: Blob | File | null | undefined): string | null {
  const [state, setState] = useState<{
    object: Blob | File | null | undefined;
    url: string | null;
  }>(() => ({
    object,
    url: object && object instanceof Blob ? URL.createObjectURL(object) : null,
  }));

  if (state.object !== object) {
    const newUrl = object && object instanceof Blob ? URL.createObjectURL(object) : null;
    if (state.url) {
      try {
        URL.revokeObjectURL(state.url);
      } catch {
        // ignore
      }
    }
    setState({ object, url: newUrl });
  }

  useEffect(() => {
    return () => {
      if (state.url) {
        try {
          URL.revokeObjectURL(state.url);
        } catch {
          // ignore
        }
      }
    };
  }, [state.url]);

  return state.url;
}

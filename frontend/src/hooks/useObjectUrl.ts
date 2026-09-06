import { useEffect, useState } from 'react';

/**
 * Хук для безопасного создания и освобождения Object URL (Blob/File).
 * Гарантирует вызов URL.revokeObjectURL при смене объекта или размонтировании
 * для предотвращения утечек памяти.
 */
export function useObjectUrl(object: Blob | File | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!object || !(object instanceof Blob)) {
      setUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(object);
    setUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [object]);

  return url;
}

import { useEffect, useState } from 'react';

/**
 * Отзывы, отложенные до следующего такта. StrictMode в разработке
 * монтирует эффект дважды: «снять — поставить» подряд. Отзови мы адрес
 * сразу при снятии, повторная установка получила бы мёртвый адрес, и
 * картинка не показалась бы (превью вложений в композере). Поэтому отзыв
 * ждёт такт, а повторная установка того же адреса его отменяет.
 */
const pendingRevokes = new Map<string, ReturnType<typeof setTimeout>>();

function revokeLater(url: string) {
  pendingRevokes.set(
    url,
    setTimeout(() => {
      pendingRevokes.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 0)
  );
}

function keep(url: string) {
  const pending = pendingRevokes.get(url);
  if (pending === undefined) return;
  clearTimeout(pending);
  pendingRevokes.delete(url);
}

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

  // Прежний адрес отзовёт очистка эффекта: он зависит от адреса.
  if (state.object !== object) {
    const newUrl = object && object instanceof Blob ? URL.createObjectURL(object) : null;
    setState({ object, url: newUrl });
  }

  useEffect(() => {
    const { url } = state;
    if (!url) return;
    keep(url);
    return () => revokeLater(url);
  }, [state]);

  return state.url;
}

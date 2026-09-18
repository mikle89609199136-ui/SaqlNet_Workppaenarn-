import { useSyncExternalStore } from 'react';

/* Тот же порог, что у `md:` в Tailwind. Держать своё число значило бы
   получить полосу, где разметка уже считает экран широким, а этот хук —
   ещё узким. */
const MOBILE_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

/* Вне браузера ширины нет — считаем экран широким. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Узкий ли экран.
 *
 * Через `useSyncExternalStore`, а не через эффект с `useState`: ширина
 * окна — внешнее состояние, и React умеет читать такое сам.
 *
 * Прежняя версия звала `window.matchMedia` прямо в теле хука, на каждом
 * рендере, а подписку вешала на объект из первого — то есть значение
 * между первым рендером и подпиской могло измениться незамеченным.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

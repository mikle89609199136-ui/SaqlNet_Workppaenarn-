import { type RefObject, useEffect, useRef } from 'react';

/**
 * Вызвать обработчик при нажатии вне элемента.
 *
 * Обработчик хранится в ссылке и обновляется отдельным эффектом, а
 * подписка ставится один раз. Иначе получается одно из двух: либо
 * подписка пересоздаётся на каждый рендер (колбэком почти всегда
 * передают стрелку, а она новая каждый раз), либо — как было здесь —
 * подписан обработчик из первого рендера, замкнувший первую версию
 * колбэка. Второе тише и хуже: меню закрывается, но вызывает вчерашнюю
 * функцию с устаревшим состоянием.
 */
export const useClickOutside = <T extends HTMLElement>(
  ref: RefObject<T | null>,
  cb: () => void
) => {
  const callback = useRef(cb);

  useEffect(() => {
    callback.current = cb;
  }, [cb]);

  useEffect(() => {
    const handleClick = (event: PointerEvent) => {
      if (
        ref.current instanceof Node &&
        event.target instanceof Node &&
        !ref.current.contains(event.target)
      ) {
        callback.current();
      }
    };

    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [ref]);
};

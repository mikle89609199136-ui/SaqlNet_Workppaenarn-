import { vi } from 'vitest';

interface IThreadLayout {
  viewport: number;
  row?: number;
}

const rect = (height: number) =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height, width: 800, height }) as DOMRect;

export function mockThreadLayout({ viewport, row }: IThreadLayout) {
  const original = Element.prototype.getBoundingClientRect;
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element
  ) {
    if (this.classList.contains('thread-messages')) return rect(viewport);
    if (row && this.hasAttribute('data-index')) return rect(row);
    return original.call(this);
  });
}

export function setPageActive({ visible = true, focused = true } = {}) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  });
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event(focused ? 'focus' : 'blur'));
}

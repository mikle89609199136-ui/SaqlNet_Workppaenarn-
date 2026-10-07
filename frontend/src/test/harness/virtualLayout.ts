import { fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

interface IVirtualLayout {
  viewport: number;
  row?: number;
}

const rect = (height: number) =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height, width: 800, height }) as DOMRect;

export function mockVirtualLayout(container: string, { viewport, row }: IVirtualLayout) {
  const original = Element.prototype.getBoundingClientRect;
  if (row) {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.hasAttribute('data-index') ? row : 0;
    });
  }
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element
  ) {
    if (this.matches(container)) return rect(viewport);
    if (row && this.hasAttribute('data-index')) return rect(row);
    return original.call(this);
  });
}

export function scrollElementTo(element: Element, top: number) {
  Object.defineProperty(element, 'scrollTop', { configurable: true, writable: true, value: top });
  fireEvent.scroll(element);
}

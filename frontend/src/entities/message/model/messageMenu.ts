import type { IActionMenu } from '@/entities/chat';
import type { KeyboardEvent } from 'react';

const BUBBLE_SELECTOR = '.message-bubble';

export function menuPointNear(element: Element): Pick<IActionMenu, 'x' | 'y'> {
  const anchor = element.querySelector(BUBBLE_SELECTOR) ?? element;
  const { left, bottom } = anchor.getBoundingClientRect();
  return { x: left, y: bottom };
}

export const opensMessageMenu = (event: KeyboardEvent) =>
  event.key === 'Enter' || event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);

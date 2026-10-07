import { mockVirtualLayout } from './virtualLayout';

export function mockThreadLayout(layout: { viewport: number; row?: number }) {
  return mockVirtualLayout('.thread-messages', layout);
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

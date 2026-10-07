import { mockVirtualLayout } from './virtualLayout';

export function mockChatListLayout(layout: { viewport: number; row?: number }) {
  return mockVirtualLayout('[role="tabpanel"]', layout);
}

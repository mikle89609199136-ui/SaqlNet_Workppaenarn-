import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { SavedMessagesPanel } from './SavedMessagesPanel';

/* Панель «Избранного» (#1075): вместо профиля — общее в этом чате. */
describe('панель «Избранного»', () => {
  it('заголовок «Избранное» и общее этого чата, без запроса профиля', async () => {
    const requested: string[] = [];
    server.use(
      http.get(api('/chats/:chatId/shared'), ({ request }) => {
        requested.push(new URL(request.url).pathname + new URL(request.url).search);
        return HttpResponse.json({ messages: [] });
      }),
      http.get(api('/users/:userId/profile'), ({ request }) => {
        requested.push(new URL(request.url).pathname);
        return HttpResponse.json({});
      })
    );

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nextProvider i18n={testI18n}>
          <MemoryRouter initialEntries={['/chats/chat-saved']}>
            <SavedMessagesPanel chatId="chat-saved" onClose={vi.fn()} />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>
    );

    expect(screen.getByRole('heading', { name: 'Избранное' })).toBeInTheDocument();
    await waitFor(() =>
      expect(requested.some((url) => url.startsWith('/api/v2/chats/chat-saved/shared'))).toBe(true)
    );
    expect(requested.some((url) => url.includes('/profile'))).toBe(false);
  });
});

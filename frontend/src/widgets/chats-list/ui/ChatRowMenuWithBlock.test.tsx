import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createRef } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import type { IChatDto } from '@/entities/chat';
import { ChatRowMenu } from '@/features/chat-actions';
import { makeChat } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { ChatRowMenuWithBlock } from './ChatRowMenuWithBlock';

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>
    </QueryClientProvider>
  );
}

const menuProps = (chat: IChatDto, onClose = vi.fn()) => ({
  chat,
  onClose,
  pinnedCount: 0,
  returnFocusRef: createRef<HTMLElement>(),
  x: 0,
  y: 0,
});

const privateChat = (extra: Partial<IChatDto> = {}) =>
  makeChat({ id: 'chat-1', type: 'private', peerId: 'user-peer', title: 'Борис', ...extra });

describe('пункт блокировки в меню строки чата (#727)', () => {
  it('без действия блокировки пункта нет', () => {
    renderWith(<ChatRowMenu {...menuProps(privateChat())} />);

    expect(screen.queryByRole('menuitem', { name: 'Заблокировать' })).not.toBeInTheDocument();
  });

  it('«Заблокировать» не закрывает меню само — это сделает подтверждение', async () => {
    const onBlock = vi.fn();
    const props = menuProps(privateChat());
    renderWith(<ChatRowMenu {...props} block={{ blocked: false, onBlock, onUnblock: vi.fn() }} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Заблокировать' }));

    expect(onBlock).toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('«Разблокировать» снимает блокировку и закрывает меню', async () => {
    const onUnblock = vi.fn();
    const props = menuProps(privateChat());
    renderWith(<ChatRowMenu {...props} block={{ blocked: true, onBlock: vi.fn(), onUnblock }} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Разблокировать' }));

    expect(onUnblock).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('меню строки чата вместе с блокировкой (виджет)', () => {
  it('блокирует после подтверждения; меню прячется на время диалога', async () => {
    const blocked: string[] = [];
    server.use(
      http.post(api('/users/blocked'), async ({ request }) => {
        blocked.push(((await request.json()) as { userId: string }).userId);
        return HttpResponse.json({ success: true }, { status: 201 });
      })
    );
    const props = menuProps(privateChat());
    renderWith(<ChatRowMenuWithBlock {...props} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Заблокировать' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Заблокировать Борис?');
    expect(screen.queryByRole('menuitem', { name: 'Закрепить' })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Заблокировать' }));

    await waitFor(() => expect(blocked).toEqual(['user-peer']));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it('отмена в диалоге закрывает всё без блокировки', async () => {
    const blocked: string[] = [];
    server.use(
      http.post(api('/users/blocked'), () => {
        blocked.push('x');
        return HttpResponse.json({ success: true }, { status: 201 });
      })
    );
    const props = menuProps(privateChat());
    renderWith(<ChatRowMenuWithBlock {...props} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Заблокировать' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /отмена/i })
    );

    expect(props.onClose).toHaveBeenCalled();
    expect(blocked).toEqual([]);
  });

  it('заблокированный — «Разблокировать», признак берётся из самого чата', async () => {
    const unblocked: string[] = [];
    server.use(
      http.delete(api('/users/blocked/:userId'), ({ params }) => {
        unblocked.push(String(params.userId));
        return HttpResponse.json({ success: true });
      })
    );
    renderWith(<ChatRowMenuWithBlock {...menuProps(privateChat({ isPeerBlocked: true }))} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Разблокировать' }));

    await waitFor(() => expect(unblocked).toEqual(['user-peer']));
  });

  it('в группе блокировать некого — пункта нет', () => {
    renderWith(<ChatRowMenuWithBlock {...menuProps(makeChat({ type: 'group' }))} />);

    expect(screen.queryByRole('menuitem', { name: 'Заблокировать' })).not.toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IChatDto } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { clearToasts, getToasts } from '@/shared/ui';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { NewChatBanner } from './NewChatBanner';

const ME = 'user-me';
const PEER = 'user-peer';

const strangerChat = (extra: Partial<IChatDto> = {}) =>
  makeChat({
    id: 'chat-1',
    type: 'private',
    peerId: PEER,
    ownerId: PEER,
    title: 'Борис',
    ...extra,
  });
const fromPeer = makeMessage({ id: 'm-1', senderId: PEER });
const fromMe = makeMessage({ id: 'm-2', senderId: ME });

function renderBanner(chat: IChatDto, messages = [fromPeer], hasOlder = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={testI18n}>
        <NewChatBanner chat={chat} hasOlder={hasOlder} messages={messages} />
      </I18nextProvider>
    </QueryClientProvider>
  );
}

const banner = () => screen.queryByRole('region', { name: 'Новый собеседник' });

beforeEach(() => {
  useProfileStore.setState({ user: makeUser({ id: ME }) });
  server.use(http.get(api('/users/blocked'), () => HttpResponse.json({ blocked: null })));
  clearToasts();
});

afterEach(() => {
  localStorage.clear();
});

describe('плашка в новом чате от незнакомого (#465)', () => {
  it('видна, когда чат начал собеседник, а вы ещё не ответили', () => {
    renderBanner(strangerChat());

    expect(banner()).toHaveTextContent('написал вам первым');
    expect(screen.getByRole('button', { name: 'Заблокировать' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пожаловаться' })).toBeInTheDocument();
  });

  it.each([
    ['вы уже ответили', strangerChat(), [fromPeer, fromMe], false],
    ['чат начали вы', strangerChat({ ownerId: ME }), [fromPeer], false],
    ['собеседник ещё ничего не написал', strangerChat(), [], false],
    ['история загружена не вся — чат не новый', strangerChat(), [fromPeer], true],
    ['вы его уже заблокировали', strangerChat({ isPeerBlocked: true }), [fromPeer], false],
    ['он заблокировал вас', strangerChat({ isBlockedByPeer: true }), [fromPeer], false],
    ['группа, а не личный чат', strangerChat({ type: 'group' }), [fromPeer], false],
  ])('не видна: %s', (_name, chat, messages, hasOlder) => {
    renderBanner(chat as IChatDto, messages, hasOlder as boolean);

    expect(banner()).not.toBeInTheDocument();
  });

  it('«Пожаловаться» отправляет жалобу на пользователя', async () => {
    const reports: unknown[] = [];
    server.use(
      http.post(api('/admin/reports'), async ({ request }) => {
        reports.push(await request.json());
        return HttpResponse.json({ reportId: 'r-1' }, { status: 201 });
      })
    );
    renderBanner(strangerChat());

    await userEvent.click(screen.getByRole('button', { name: 'Пожаловаться' }));

    await waitFor(() =>
      expect(reports).toEqual([{ targetType: 'user', targetId: PEER, reason: 'spam' }])
    );
    expect(await screen.findByRole('button', { name: 'Жалоба отправлена' })).toBeDisabled();
    expect(getToasts().map((toast) => toast.type)).toEqual(['success']);
  });

  it('ошибка жалобы — сообщение, повторить можно', async () => {
    server.use(http.post(api('/admin/reports'), () => HttpResponse.json({}, { status: 500 })));
    renderBanner(strangerChat());

    await userEvent.click(screen.getByRole('button', { name: 'Пожаловаться' }));

    await waitFor(() => expect(getToasts().map((toast) => toast.type)).toEqual(['error']));
    expect(screen.getByRole('button', { name: 'Пожаловаться' })).toBeEnabled();
  });

  it('«Скрыть» убирает плашку и запоминает это для чата', async () => {
    const { unmount } = renderBanner(strangerChat());

    await userEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
    expect(banner()).not.toBeInTheDocument();
    unmount();

    renderBanner(strangerChat());
    expect(banner()).not.toBeInTheDocument();

    // В другом чате — снова видна.
    renderBanner(strangerChat({ id: 'chat-2' }));
    expect(banner()).toBeInTheDocument();
  });
});

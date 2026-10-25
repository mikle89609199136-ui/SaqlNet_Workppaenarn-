import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { makeChatScenario } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

/**
 * «Избранное» — чат с самим собой (#1075). Сервер отдаёт его с типом
 * `self`, без собеседника. Раньше он выглядел бы перепиской с человеком,
 * который «был давно».
 */

function savedScenario() {
  const scenario = makeChatScenario({
    messages: 1,
    chat: { type: 'self', peerId: undefined, title: 'Избранное' } as never,
  });
  server.use(
    http.get(api(`/chats/${scenario.chat.id}`), () => HttpResponse.json({ chat: scenario.chat })),
    http.get(api(`/messages/${scenario.chat.id}`), () =>
      HttpResponse.json({ messages: scenario.messages })
    ),
    http.get(api(`/chats/${scenario.chat.id}/pins`), () => HttpResponse.json({ pins: [] }))
  );
  return scenario;
}

beforeEach(() => {
  useChatUiStore.setState({ deleteTargets: null, selectedMessages: [], selectionMode: false });
});

describe('чат «Избранное»', () => {
  it('в шапке «Избранное» без «был(а)» и без звонков', async () => {
    const { chat, messages } = savedScenario();

    renderChatThread({ chat, messages });

    const header = await screen.findByRole('button', { name: /^Избранное — / });
    expect(header).toHaveTextContent('Избранное');
    expect(screen.queryByText(/был|онлайн/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Позвонить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Видеозвонок' })).toBeNull();
  });

  it('нажатие на шапку открывает панель «Избранного»', async () => {
    const onProfileStateChange = vi.fn();
    const { chat, messages } = savedScenario();

    renderChatThread({ chat, messages, onProfileStateChange });
    await userEvent.click(await screen.findByRole('button', { name: /^Избранное — / }));

    await waitFor(() =>
      expect(onProfileStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ isOpen: true, userId: null, kind: 'saved' })
      )
    );
  });

  it('удаление — без вопроса про собеседника, сообщение удаляется совсем', async () => {
    const { chat, messages } = savedScenario();
    const requests: Array<{ messageIds: string[]; forEveryone: boolean }> = [];
    server.use(
      http.post(api(`/chats/${chat.id}/messages/delete`), async ({ request }) => {
        requests.push((await request.json()) as never);
        return HttpResponse.json({ success: true, lastMessage: null });
      })
    );

    renderChatThread({ chat, messages });
    fireEvent.contextMenu(await screen.findByText('сообщение 1'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).queryByRole('checkbox')).toBeNull();
    expect(confirm).toHaveTextContent('исчезнут из Избранного');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));

    await waitFor(() =>
      expect(requests).toEqual([{ messageIds: [messages[0].id], forEveryone: true }])
    );
  });
});

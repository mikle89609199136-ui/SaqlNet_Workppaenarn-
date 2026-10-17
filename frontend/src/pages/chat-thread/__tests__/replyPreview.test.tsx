import { http, HttpResponse } from 'msw';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { makeChatScenario, makeMessage } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

/**
 * Ответ на сообщение, которого нет в загруженной ленте (#1065).
 *
 * Исходник давний — его не догрузить, а сервер присылает в ответе превью
 * исходного сообщения, в шифрованном чате — конвертом. Раньше плашка
 * показывала одно слово «Сообщение».
 */

/** Конверт в том виде, в каком его открывает подмена шифрования страницы. */
function sealed(text: string): string {
  return JSON.stringify({
    v: 2,
    epoch: 1,
    marker: 'e2e-stub',
    ct: btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ text, entities: [] })))
    ),
  });
}

describe('цитата на сообщение вне ленты', () => {
  it('показывает расшифрованный текст исходника и снимает его после удаления', async () => {
    const { chat } = makeChatScenario({ messages: 0 });
    const reply = makeMessage({
      id: 'm-reply',
      chatId: chat.id,
      senderId: 'user-2',
      content: sealed('ответ на давнее'),
      replyTo: 'm-old',
      replyPreview: {
        id: 'm-old',
        content: sealed('самое первое сообщение'),
        type: 'text',
        senderId: 'user-1',
        senderName: 'Я',
        reactions: [],
      },
    });
    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [reply] })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.post(api('/messages/read'), () => HttpResponse.json({ success: true }))
    );

    // Без готовой ленты: история проходит через сервис, как в приложении.
    renderChatThread({ chat });

    expect(await screen.findByText('ответ на давнее')).toBeInTheDocument();
    expect(await screen.findByText('самое первое сообщение')).toBeInTheDocument();
    expect(screen.queryByText(/e2e-stub/)).toBeNull();

    act(() => {
      fakeSocket.emit('messages_deleted', { chatId: chat.id, messageIds: ['m-old'] });
    });

    await waitFor(() => expect(screen.queryByText('самое первое сообщение')).toBeNull());
    const quote = screen.getByRole('button', { name: 'Перейти к сообщению' });
    expect(within(quote).getByText('Сообщение')).toBeInTheDocument();
  });
});

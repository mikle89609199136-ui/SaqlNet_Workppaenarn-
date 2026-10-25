import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { services } from '@/services/serviceContainer';
import { clearMediaObjectUrls } from '@/entities/media/model/mediaObjectUrls';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { makeChatScenario, makeMessage, resetFixtures } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { IMessageDto } from '@/types';

/**
 * «Повторить» у вложения, которое не скачалось (#1062).
 *
 * Фото в ленте уже в состоянии «не скачалось» — так его оставляет первый
 * показ истории при обрыве сети. Повтор скачивает файл заново и меняет
 * одно сообщение, историю чата не перезапрашивая.
 */

const MEDIA_ID = '00000000-0000-4000-8000-0000000004a0';

describe('повтор скачивания вложения', () => {
  let historyRequests: number;
  let mediaRequests: number;

  beforeEach(() => {
    resetFixtures();
    historyRequests = 0;
    mediaRequests = 0;
  });

  afterEach(() => {
    clearMediaObjectUrls();
    vi.restoreAllMocks();
  });

  it('«Повторить» показывает фото без перезапроса истории', async () => {
    const { chat } = makeChatScenario({ messages: 0 });
    const photo = {
      ...makeMessage({ id: 'm-photo', chatId: chat.id, senderId: 'user-2', content: '' }),
      type: 'image',
      metadata: { mediaUrl: `/api/v2/media/${MEDIA_ID}`, mediaEncrypted: true },
      mediaUrl: null,
      mediaUnavailable: true,
      mediaUnavailableReason: 'downloadFailed',
    } as unknown as IMessageDto;
    server.use(
      http.get(api(`/messages/${chat.id}`), () => {
        historyRequests += 1;
        return HttpResponse.json({ messages: [photo] });
      }),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.post(api('/messages/read'), () => HttpResponse.json({ success: true })),
      http.get(api(`/media/${MEDIA_ID}`), () => {
        mediaRequests += 1;
        return HttpResponse.json({ encrypted: true });
      })
    );
    vi.spyOn(services.cryptoService, 'decryptMedia').mockResolvedValue(
      new Blob(['png'], { type: 'image/png' })
    );
    const user = userEvent.setup();

    const { container } = renderChatThread({ chat, messages: [photo] });

    expect(await screen.findByText('Не удалось загрузить медиа')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Загрузить медиа ещё раз' }));

    await waitFor(() => expect(container.querySelector('img.message-media')).not.toBeNull());
    expect(container.querySelector('img.message-media')?.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.queryByText('Не удалось загрузить медиа')).toBeNull();
    expect(mediaRequests).toBe(1);
    expect(historyRequests).toBe(0);
  });
});

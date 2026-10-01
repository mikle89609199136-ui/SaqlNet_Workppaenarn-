import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';

/* Звонки — только один на один (#715): сервер не создаёт комнату в группе,
   и кнопок, которые ведут в ошибку, в шапке быть не должно. */
describe('кнопки звонка в шапке чата', () => {
  it('в личном чате — аудио и видео', async () => {
    const chat = makeChat({ type: 'private', peerId: 'user-2', title: 'Максим' });
    renderChatThread({ chat, messages: [makeMessage({ chatId: chat.id })] });

    expect(await screen.findByRole('button', { name: 'Позвонить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Видеозвонок' })).toBeInTheDocument();
  });

  it('в группе — нет', async () => {
    const chat = makeChat({ type: 'group', title: 'Команда' });
    renderChatThread({ chat, messages: [makeMessage({ chatId: chat.id })] });

    await screen.findByText('Команда');
    expect(screen.queryByRole('button', { name: 'Позвонить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Видеозвонок' })).not.toBeInTheDocument();
  });
});

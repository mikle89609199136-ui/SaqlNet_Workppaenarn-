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

describe('доступность звонков из ChatDTO (#1056)', () => {
  it.each([true, undefined])('сохраняет кнопки при canCall=%s', async (canCall) => {
    const chat = makeChat({ type: 'private', title: 'Собеседник', canCall });
    renderChatThread({ chat, messages: [] });
    expect(await screen.findByRole('button', { name: 'Позвонить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Видеозвонок' })).toBeInTheDocument();
  });
  it('при false скрывает оба звонка, сохраняя переписку', async () => {
    const chat = makeChat({ type: 'private', title: 'Собеседник', canCall: false });
    renderChatThread({
      chat,
      messages: [makeMessage({ chatId: chat.id, content: 'Переписка доступна' })],
    });
    await screen.findByText('Собеседник');
    expect(screen.queryByRole('button', { name: 'Позвонить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Видеозвонок' })).not.toBeInTheDocument();
    expect(screen.getByText('Переписка доступна')).toBeInTheDocument();
  });
});

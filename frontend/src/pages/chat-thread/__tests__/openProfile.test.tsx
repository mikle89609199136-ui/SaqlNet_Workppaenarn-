import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeChat, makeMessage } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';

/**
 * Клик по аватарке в шапке чата.
 *
 * Панель профиля рисует не страница чата, а `ChatsPage`: страница лишь
 * называет, чей профиль показать. Поэтому проверяется то, что уходит
 * наверх, — а не появление панели в разметке.
 *
 * Заведено по #357: панель не открывалась, а связь между кликом и
 * открытием проходит через четыре слоя, и разрыв в любом из них снова
 * останется незамеченным.
 */
describe('профиль собеседника из шапки', () => {
  it('клик по аватарке называет, чей профиль показать', async () => {
    const onProfileStateChange = vi.fn();
    const chat = makeChat({ type: 'private', peerId: 'user-2', title: 'Максим' });

    renderChatThread({ chat, messages: [makeMessage({ chatId: chat.id })], onProfileStateChange });

    await userEvent.click(await screen.findByRole('button', { name: /^Максим — / }));

    await waitFor(() =>
      expect(onProfileStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ isOpen: true, userId: 'user-2' })
      )
    );
  });

  it('повторный клик закрывает', async () => {
    const onProfileStateChange = vi.fn();
    const chat = makeChat({ type: 'private', peerId: 'user-2', title: 'Максим' });

    renderChatThread({ chat, messages: [makeMessage({ chatId: chat.id })], onProfileStateChange });

    const avatar = await screen.findByRole('button', { name: /^Максим — / });
    await userEvent.click(avatar);
    await waitFor(() =>
      expect(onProfileStateChange).toHaveBeenCalledWith(expect.objectContaining({ isOpen: true }))
    );

    onProfileStateChange.mockClear();
    await userEvent.click(avatar);

    await waitFor(() =>
      expect(onProfileStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ isOpen: false, userId: null })
      )
    );
  });

  it('в группе открывает сведения о группе, а не профиль', async () => {
    const onProfileStateChange = vi.fn();
    const chat = makeChat({ type: 'group', peerId: undefined, title: 'Проверка окон' });

    renderChatThread({ chat, messages: [makeMessage({ chatId: chat.id })], onProfileStateChange });

    await userEvent.click(await screen.findByRole('button', { name: /^Проверка окон — / }));

    expect(await screen.findByRole('dialog', { name: /группе/i })).toBeInTheDocument();
    // Профиль собеседника у группы не спрашивают: собеседников много.
    expect(onProfileStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ isOpen: true })
    );
  });
});

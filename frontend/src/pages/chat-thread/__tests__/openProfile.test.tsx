import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeChat, makeMessage } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { useChatUiStore } from '@/entities/chat';

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

    // Сведения о группе — в правой панели (#822): тред просит открыть
    // её, а не профиль одного собеседника — собеседников много.
    await waitFor(() =>
      expect(onProfileStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ isOpen: true, kind: 'group', userId: null })
      )
    );
  });
});

/* Профиль из истории звонков (#1074): виджет кладёт запрос и открывает
   чат, страница чата выполняет его и сбрасывает. */
describe('профиль по запросу из истории звонков', () => {
  it('запрос для этого чата, поставленный до открытия, открывает профиль', async () => {
    const onProfileStateChange = vi.fn();
    const chat = makeChat({ type: 'private', peerId: 'user-2', title: 'Максим' });
    useChatUiStore.getState().setProfileRequest({ chatId: chat.id, userId: 'user-2' });

    renderChatThread({ chat, messages: [makeMessage({ chatId: chat.id })], onProfileStateChange });

    await waitFor(() =>
      expect(onProfileStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ isOpen: true, userId: 'user-2' })
      )
    );
    expect(useChatUiStore.getState().profileRequest).toBeNull();
  });

  it('запрос, поставленный, когда чат уже открыт, тоже открывает', async () => {
    const onProfileStateChange = vi.fn();
    const chat = makeChat({ type: 'private', peerId: 'user-2', title: 'Максим' });
    renderChatThread({ chat, messages: [makeMessage({ chatId: chat.id })], onProfileStateChange });
    await screen.findByRole('button', { name: /^Максим — / });

    act(() => useChatUiStore.getState().setProfileRequest({ chatId: chat.id, userId: 'user-2' }));

    await waitFor(() =>
      expect(onProfileStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ isOpen: true, userId: 'user-2' })
      )
    );
  });

  it('запрос для другого чата профиль не открывает', async () => {
    const onProfileStateChange = vi.fn();
    const chat = makeChat({ type: 'private', peerId: 'user-2', title: 'Максим' });
    useChatUiStore.getState().setProfileRequest({ chatId: 'chat-other', userId: 'user-9' });

    renderChatThread({ chat, messages: [makeMessage({ chatId: chat.id })], onProfileStateChange });
    await screen.findByRole('button', { name: /^Максим — / });

    expect(onProfileStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ isOpen: true })
    );
  });
});

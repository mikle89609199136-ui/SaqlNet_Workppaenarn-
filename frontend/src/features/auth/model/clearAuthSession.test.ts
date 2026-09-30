import { beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from '@/shared/api';
import { chatKeys, useChatUiStore } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { clearAuthSession } from './clearAuthSession';

describe('выход из сессии', () => {
  beforeEach(() => {
    queryClient.clear();
    useProfileStore.setState({ isAuth: true });
  });

  it('should wipe decrypted messages from the query cache', () => {
    // В кеше лежит расшифрованная переписка. Если она переживёт выход,
    // её увидит следующий, кто войдёт в этой же вкладке.
    queryClient.setQueryData(chatKeys.messages('chat-1'), {
      pages: [[{ id: 'm-1', content: 'секретное сообщение' }]],
      pageParams: [0],
    });

    clearAuthSession();

    expect(queryClient.getQueryData(chatKeys.messages('chat-1'))).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('should wipe shown translations', () => {
    // Перевод — это тот же расшифрованный текст, только ещё и отправленный
    // наружу. Он сбрасывается при смене чата, но выход чата не меняет.
    useChatUiStore.getState().setTranslations({ 'm-1': 'переведённый секрет' });

    clearAuthSession();

    expect(useChatUiStore.getState().translations).toEqual({});
  });

  it('should do nothing without an active session', () => {
    useProfileStore.setState({ isAuth: false });
    queryClient.setQueryData(chatKeys.detail('chat-1'), { id: 'chat-1' });

    clearAuthSession();

    // Выход без сессии — не событие: чужой кеш трогать не за что.
    expect(queryClient.getQueryData(chatKeys.detail('chat-1'))).toBeDefined();
  });
});

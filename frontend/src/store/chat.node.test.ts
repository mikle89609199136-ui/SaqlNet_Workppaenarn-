import { beforeEach, describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import { useChatStore } from './chat';

// Данные чата переехали в кеш запросов, здесь осталось только состояние
// интерфейса. Проверки отметки о прочтении и обновления закреплённых теперь
// живут рядом с новой реализацией — в threadCache и useMarkAsRead.
describe('состояние интерфейса чата', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState(), true);
  });

  it('should keep the draft and the message being edited', () => {
    const message = makeMessage();

    useChatStore.getState().setDraft('черновик');
    useChatStore.getState().setEditingMessage(message);

    expect(useChatStore.getState().draft).toBe('черновик');
    expect(useChatStore.getState().editingMessage?.id).toBe(message.id);
  });

  it('should collect selected messages', () => {
    const first = makeMessage();
    const second = makeMessage();

    useChatStore.getState().setSelectionMode(true);
    useChatStore.getState().setSelectedMessages([first]);
    useChatStore.getState().setSelectedMessages((items) => [...items, second]);

    expect(useChatStore.getState().selectedMessages).toHaveLength(2);
  });

  it('should drop everything when the chat is left', () => {
    // Черновик и выделение принадлежат конкретному чату: при переходе
    // в соседний они не должны переезжать вместе с окном.
    useChatStore.getState().setDraft('черновик');
    useChatStore.getState().setSelectionMode(true);
    useChatStore.getState().setActionMenu({ messageId: 'm-1', x: 0, y: 0 });
    useChatStore.getState().setError('ошибка');

    useChatStore.getState().resetChatState();

    const state = useChatStore.getState();
    expect(state.draft).toBe('');
    expect(state.selectionMode).toBe(false);
    expect(state.actionMenu).toBeNull();
    expect(state.error).toBe('');
  });

  it('should no longer hold server data', () => {
    // Возврат сообщений сюда означал бы возвращение двух источников правды
    // и ручной синхронизации между ними.
    const state = useChatStore.getState() as unknown as Record<string, unknown>;

    expect(state.messages).toBeUndefined();
    expect(state.chat).toBeUndefined();
    expect(state.pinnedMessages).toBeUndefined();
  });
});

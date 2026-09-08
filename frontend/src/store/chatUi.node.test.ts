import { beforeEach, describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import { useChatUiStore } from './chatUi';

// Данные чата переехали в кеш запросов, здесь осталось только состояние
// интерфейса. Проверки отметки о прочтении и обновления закреплённых теперь
// живут рядом с новой реализацией — в threadCache и useMarkAsRead.
describe('состояние интерфейса чата', () => {
  beforeEach(() => {
    useChatUiStore.setState(useChatUiStore.getInitialState(), true);
  });

  it('should keep the message being edited', () => {
    // Недописанный текст здесь больше не хранится: он живёт в chatDrafts,
    // отдельно для каждого чата и вне React.
    const message = makeMessage();

    useChatUiStore.getState().setEditingMessage(message);

    expect(useChatUiStore.getState().editingMessage?.id).toBe(message.id);
  });

  it('should collect selected messages', () => {
    const first = makeMessage();
    const second = makeMessage();

    useChatUiStore.getState().setSelectionMode(true);
    useChatUiStore.getState().setSelectedMessages([first]);
    useChatUiStore.getState().setSelectedMessages((items) => [...items, second]);

    expect(useChatUiStore.getState().selectedMessages).toHaveLength(2);
  });

  it('should drop everything when the chat is left', () => {
    // Выделение и открытые меню принадлежат конкретному чату: при переходе
    // в соседний они не должны переезжать вместе с окном.
    useChatUiStore.getState().setSelectionMode(true);
    useChatUiStore.getState().setActionMenu({ messageId: 'm-1', x: 0, y: 0 });
    useChatUiStore.getState().setHighlightedMessageId('m-1');
    useChatUiStore.getState().setError('ошибка');

    useChatUiStore.getState().resetChatState();

    const state = useChatUiStore.getState();
    expect(state.selectionMode).toBe(false);
    expect(state.actionMenu).toBeNull();
    expect(state.highlightedMessageId).toBeNull();
    expect(state.error).toBe('');
  });

  it('should set and clear highlighted message id', () => {
    useChatUiStore.getState().setHighlightedMessageId('m-1');
    expect(useChatUiStore.getState().highlightedMessageId).toBe('m-1');

    useChatUiStore.getState().setHighlightedMessageId(null);
    expect(useChatUiStore.getState().highlightedMessageId).toBeNull();
  });

  it('should no longer hold server data', () => {
    // Возврат сообщений сюда означал бы возвращение двух источников правды
    // и ручной синхронизации между ними.
    const state = useChatUiStore.getState() as unknown as Record<string, unknown>;

    expect(state.messages).toBeUndefined();
    expect(state.chat).toBeUndefined();
    expect(state.pinnedMessages).toBeUndefined();
  });
});

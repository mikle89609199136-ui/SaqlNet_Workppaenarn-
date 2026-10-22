import { describe, expect, it } from 'vitest';
import { WS_EVENTS } from '@/shared/config';
import { chatKeys } from '@/entities/chat';
import { userKeys } from '@/entities/user';
import { IGNORED_EVENTS, INVALIDATION_MAP, resolveInvalidations } from './invalidationMap';

/** Все объявленные типы событий — плоским списком. */
function collectEventTypes(source: object): string[] {
  return Object.values(source).flatMap((value) =>
    typeof value === 'string' ? [value] : collectEventTypes(value as object)
  );
}

describe('полнота таблицы событий', () => {
  it('should cover or explicitly ignore every declared event', () => {
    // Главная проверка: забыть обработать новое событие невозможно.
    // Либо оно в таблице, либо в списке намеренно игнорируемых.
    const uncovered = collectEventTypes(WS_EVENTS).filter(
      (type) => !INVALIDATION_MAP[type] && !IGNORED_EVENTS.includes(type)
    );

    expect(uncovered).toEqual([]);
  });

  it('should not both handle and ignore the same event', () => {
    const contradictory = IGNORED_EVENTS.filter((type) => INVALIDATION_MAP[type]);

    expect(contradictory).toEqual([]);
  });
});

describe('что устаревает при событии', () => {
  const chatId = 'chat-1';

  it('only invalidates settings for the current owner and known event version', () => {
    expect(
      resolveInvalidations(WS_EVENTS.USER.SETTINGS_UPDATED, {
        userId: 'owner',
        currentUserId: 'owner',
        version: 1,
      })
    ).toEqual([userKeys.settings()]);
    for (const payload of [
      { userId: 'foreign', currentUserId: 'owner', version: 1 },
      { userId: 'owner', currentUserId: 'owner', version: 2 },
      {},
    ])
      expect(resolveInvalidations(WS_EVENTS.USER.SETTINGS_UPDATED, payload)).toEqual([]);
  });

  it('should refresh the thread and the chat list on a new message', () => {
    expect(resolveInvalidations(WS_EVENTS.MESSAGE.NEW, { chatId })).toEqual([
      chatKeys.messages(chatId),
      chatKeys.list(),
    ]);
  });

  it('should refresh pins when a message is edited', () => {
    // Отредактированное сообщение может быть закреплено: панель закреплённых
    // хранит его копию и обязана обновиться.
    expect(resolveInvalidations(WS_EVENTS.MESSAGE.EDITED, { chatId })).toContainEqual(
      chatKeys.pins(chatId)
    );
  });

  it('should refresh pins and the chat list when a message is deleted', () => {
    const keys = resolveInvalidations(WS_EVENTS.MESSAGE.DELETED, { chatId });

    // Удалённое могло быть и закреплённым, и последним сообщением чата.
    expect(keys).toContainEqual(chatKeys.pins(chatId));
    expect(keys).toContainEqual(chatKeys.list());
  });

  it('should touch only the thread on a reaction', () => {
    expect(resolveInvalidations(WS_EVENTS.REACTIONS.REACTION_UPDATED, { chatId })).toEqual([
      chatKeys.messages(chatId),
    ]);
  });

  it('should touch only pins on pin and unpin', () => {
    expect(resolveInvalidations(WS_EVENTS.MESSAGE.PINNED, { chatId })).toEqual([
      chatKeys.pins(chatId),
    ]);
    expect(resolveInvalidations(WS_EVENTS.MESSAGE.UNPINNED, { chatId })).toEqual([
      chatKeys.pins(chatId),
    ]);
  });

  it('should invalidate nothing for an ignored event', () => {
    expect(resolveInvalidations(WS_EVENTS.USER.TYPING, { chatId })).toEqual([]);
    expect(resolveInvalidations(WS_EVENTS.CALL.OFFER, { chatId })).toEqual([]);
  });

  it('should survive an event without a chat id', () => {
    // Сервер не всегда кладёт chatId в payload: правило обязано это пережить.
    expect(() => resolveInvalidations(WS_EVENTS.MESSAGE.EDITED, {})).not.toThrow();
    expect(resolveInvalidations(WS_EVENTS.MESSAGE.EDITED, {})).toEqual([]);
  });

  it('should invalidate nothing for an unknown event', () => {
    expect(resolveInvalidations('событие-которого-нет', { chatId })).toEqual([]);
  });

  it('should refresh user profile, chat list, and me on profile update', () => {
    const peerId = 'user-peer';
    const currentUserId = 'user-me';

    // Чужой профиль: инвалидируем его карточку и список чатов
    expect(
      resolveInvalidations(WS_EVENTS.USER.PROFILE_UPDATED, {
        userId: peerId,
        currentUserId,
      })
    ).toEqual([userKeys.profile(peerId), chatKeys.list()]);

    // Свой профиль: инвалидируем карточку, список чатов и userKeys.me()
    expect(
      resolveInvalidations(WS_EVENTS.USER.PROFILE_UPDATED, {
        userId: currentUserId,
        currentUserId,
      })
    ).toEqual([userKeys.profile(currentUserId), chatKeys.list(), userKeys.me()]);

    // Без указания currentUserId (по умолчанию считается своим)
    expect(
      resolveInvalidations(WS_EVENTS.USER.PROFILE_UPDATED, {
        userId: currentUserId,
      })
    ).toEqual([userKeys.profile(currentUserId), chatKeys.list(), userKeys.me()]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllDrafts, clearDraft, readDraft, subscribeToDraft, writeDraft } from './chatDrafts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  clearAllDrafts();
  vi.useRealTimers();
});

describe('черновики чатов', () => {
  it('should keep a draft per chat', () => {
    writeDraft('chat-1', 'первому');
    writeDraft('chat-2', 'второму');

    expect(readDraft('chat-1')).toBe('первому');
    expect(readDraft('chat-2')).toBe('второму');
  });

  it('should return an empty string for a chat without a draft', () => {
    expect(readDraft('никогда-не-открывали')).toBe('');
  });

  it('should notify the chat list after the typing settles', () => {
    // Список чатов показывает пометку о черновике. Обновлять его на каждый
    // символ незачем: строка мигала бы всё время, пока человек печатает.
    const слышал: string[] = [];
    subscribeToDraft('chat-1', () => слышал.push(readDraft('chat-1')));

    writeDraft('chat-1', 'п');
    writeDraft('chat-1', 'пр');
    writeDraft('chat-1', 'при');

    expect(слышал).toEqual([]);

    vi.advanceTimersByTime(600);

    expect(слышал).toEqual(['при']);
  });

  it('should notify only the subscribers of that chat', () => {
    let первый = 0;
    let второй = 0;
    subscribeToDraft('chat-1', () => {
      первый += 1;
    });
    subscribeToDraft('chat-2', () => {
      второй += 1;
    });

    writeDraft('chat-1', 'текст');
    vi.advanceTimersByTime(600);

    expect(первый).toBe(1);
    expect(второй).toBe(0);
  });

  it('should announce clearing immediately', () => {
    // После отправки пометка обязана исчезнуть сразу, иначе в списке
    // останется черновик, которого уже нет.
    const слышал: string[] = [];
    writeDraft('chat-1', 'готово к отправке');
    vi.advanceTimersByTime(600);

    subscribeToDraft('chat-1', () => слышал.push(readDraft('chat-1')));
    clearDraft('chat-1');

    expect(слышал).toEqual(['']);
    expect(readDraft('chat-1')).toBe('');
  });

  it('should not announce a pending change after the draft was cleared', () => {
    // Иначе отложенное уведомление вернуло бы пометку через полсекунды.
    const слышал: string[] = [];
    subscribeToDraft('chat-1', () => слышал.push(readDraft('chat-1')));

    writeDraft('chat-1', 'написал');
    clearDraft('chat-1');
    vi.advanceTimersByTime(600);

    expect(слышал).toEqual(['']);
  });

  it('should stop notifying after unsubscribe', () => {
    let вызовов = 0;
    const отписаться = subscribeToDraft('chat-1', () => {
      вызовов += 1;
    });

    отписаться();
    writeDraft('chat-1', 'текст');
    vi.advanceTimersByTime(600);

    expect(вызовов).toBe(0);
  });

  it('should forget everything when the session ends', () => {
    // Черновики — открытый текст: следующему, кто войдёт в этой вкладке,
    // они доставаться не должны.
    writeDraft('chat-1', 'личное');
    writeDraft('chat-2', 'тоже личное');

    clearAllDrafts();

    expect(readDraft('chat-1')).toBe('');
    expect(readDraft('chat-2')).toBe('');
  });
});

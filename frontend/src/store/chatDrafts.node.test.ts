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
    const heard: string[] = [];
    subscribeToDraft('chat-1', () => heard.push(readDraft('chat-1')));

    writeDraft('chat-1', 'п');
    writeDraft('chat-1', 'пр');
    writeDraft('chat-1', 'при');

    expect(heard).toEqual([]);

    vi.advanceTimersByTime(600);

    expect(heard).toEqual(['при']);
  });

  it('should notify only the subscribers of that chat', () => {
    let first = 0;
    let second = 0;
    subscribeToDraft('chat-1', () => {
      first += 1;
    });
    subscribeToDraft('chat-2', () => {
      second += 1;
    });

    writeDraft('chat-1', 'текст');
    vi.advanceTimersByTime(600);

    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('should announce clearing immediately', () => {
    // После отправки пометка обязана исчезнуть сразу, иначе в списке
    // останется черновик, которого уже нет.
    const heard: string[] = [];
    writeDraft('chat-1', 'готово к отправке');
    vi.advanceTimersByTime(600);

    subscribeToDraft('chat-1', () => heard.push(readDraft('chat-1')));
    clearDraft('chat-1');

    expect(heard).toEqual(['']);
    expect(readDraft('chat-1')).toBe('');
  });

  it('should not announce a pending change after the draft was cleared', () => {
    // Иначе отложенное уведомление вернуло бы пометку через полсекунды.
    const heard: string[] = [];
    subscribeToDraft('chat-1', () => heard.push(readDraft('chat-1')));

    writeDraft('chat-1', 'написал');
    clearDraft('chat-1');
    vi.advanceTimersByTime(600);

    expect(heard).toEqual(['']);
  });

  it('should stop notifying after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeToDraft('chat-1', () => {
      calls += 1;
    });

    unsubscribe();
    writeDraft('chat-1', 'текст');
    vi.advanceTimersByTime(600);

    expect(calls).toBe(0);
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

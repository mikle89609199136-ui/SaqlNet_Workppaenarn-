import { beforeEach, describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import { selectCurrentMatch, useMessageSearchStore } from './messageSearchStore';

const found = ['m3', 'm2', 'm1'].map((id) => makeMessage({ id }));

describe('сеанс поиска по переписке (#841)', () => {
  beforeEach(() => {
    useMessageSearchStore.getState().open('chat-1');
    useMessageSearchStore.getState().setResults(found, 'complete', 3);
  });

  it('стрелки ходят к более ранним и поздним совпадениям, не выходя за края', () => {
    const { older, newer } = useMessageSearchStore.getState();

    newer();
    expect(selectCurrentMatch(useMessageSearchStore.getState())?.id).toBe('m3');
    older();
    older();
    older();
    expect(selectCurrentMatch(useMessageSearchStore.getState())?.id).toBe('m1');
  });

  it('новые результаты не сбивают текущее совпадение', () => {
    useMessageSearchStore.getState().select(1);

    useMessageSearchStore
      .getState()
      .setResults([makeMessage({ id: 'm4' }), ...found], 'loading', 4);

    expect(selectCurrentMatch(useMessageSearchStore.getState())?.id).toBe('m2');
  });

  it('новый запрос и закрытие стирают найденное', () => {
    useMessageSearchStore.getState().setQuery('другое');
    expect(useMessageSearchStore.getState().results).toEqual([]);

    useMessageSearchStore.getState().setResults(found, 'complete', 3);
    useMessageSearchStore.getState().close();
    expect(useMessageSearchStore.getState()).toMatchObject({
      chatId: null,
      query: '',
      results: [],
    });
  });
});

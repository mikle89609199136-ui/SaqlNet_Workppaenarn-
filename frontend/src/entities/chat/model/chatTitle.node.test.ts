import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { getChatTitle, isSavedMessages } from './chatTitle';
import { getChatSubtitle } from './getChatSubtitle';

/** Английский интерфейс: сервер всё равно пришлёт «Избранное» по-русски. */
const en = ((key: string, fallback?: string) =>
  key === 'savedMessages.title' ? 'Saved Messages' : (fallback ?? key)) as unknown as TFunction;

/* «Избранное» — чат с самим собой (#1075): название на языке интерфейса,
   без «был(а) давно» под ним. */
describe('название и подзаголовок «Избранного»', () => {
  it('название — из словаря, а не с сервера', () => {
    expect(getChatTitle({ type: 'self', title: 'Избранное' }, en)).toBe('Saved Messages');
  });

  it('у остальных — название с сервера или «Без названия»', () => {
    expect(getChatTitle({ type: 'private', title: 'Анна' }, en)).toBe('Анна');
    expect(getChatTitle({ type: 'group', title: '' }, en)).toBe('Без названия');
  });

  it('узнаётся по типу', () => {
    expect(isSavedMessages({ type: 'self' })).toBe(true);
    expect(isSavedMessages({ type: 'private' })).toBe(false);
    expect(isSavedMessages(null)).toBe(false);
  });

  it('подзаголовка нет, хотя полей собеседника нет', () => {
    expect(getChatSubtitle({ type: 'self' }, null, en)).toBe('');
  });
});

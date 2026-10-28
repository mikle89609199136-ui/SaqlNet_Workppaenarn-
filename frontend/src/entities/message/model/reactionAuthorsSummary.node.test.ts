import { describe, expect, it } from 'vitest';
import { formatAuthorDisplayName, formatReactionAuthorsSummary } from './reactionAuthorsSummary';
import type { IReactionAuthor } from './types';

describe('formatAuthorDisplayName', () => {
  it('объединяет имя и фамилию', () => {
    expect(
      formatAuthorDisplayName({ firstName: 'Алексей', lastName: 'Смирнов', username: 'alex' })
    ).toBe('Алексей Смирнов');
  });

  it('выводит имя при отсутствии фамилии', () => {
    expect(formatAuthorDisplayName({ firstName: 'Алексей', lastName: '', username: 'alex' })).toBe(
      'Алексей'
    );
  });

  it('выводит @username при отсутствии имени', () => {
    expect(formatAuthorDisplayName({ firstName: '', lastName: '', username: 'alex' })).toBe(
      '@alex'
    );
  });

  it('возвращает фоллбэк при пустых полях', () => {
    expect(formatAuthorDisplayName({ firstName: '', lastName: '', username: '' })).toBe(
      'Пользователь'
    );
  });
});

describe('formatReactionAuthorsSummary', () => {
  const author1: IReactionAuthor = {
    id: 'u-1',
    firstName: 'Алексей',
    lastName: 'Иванов',
    username: 'alex',
  };
  const author2: IReactionAuthor = {
    id: 'u-2',
    firstName: 'Мария',
    lastName: 'Петрова',
    username: 'maria',
  };
  const author3: IReactionAuthor = {
    id: 'u-3',
    firstName: 'Ольга',
    lastName: '',
    username: 'olga',
  };

  it('возвращает пустую строку при total <= 0', () => {
    expect(formatReactionAuthorsSummary({ authors: [], total: 0, mine: false })).toBe('');
  });

  it('возвращает "Вы", если реакция только своя', () => {
    expect(
      formatReactionAuthorsSummary({
        authors: [author1],
        total: 1,
        mine: true,
        currentUserId: 'u-1',
      })
    ).toBe('Вы');
  });

  it('возвращает "Вы и Алексей", если двое', () => {
    expect(
      formatReactionAuthorsSummary({
        authors: [author1],
        total: 2,
        mine: true,
        currentUserId: 'u-me',
      })
    ).toBe('Вы и Алексей Иванов');
  });

  it('возвращает "Вы, Алексей Иванов и ещё 2", если больше двух', () => {
    expect(
      formatReactionAuthorsSummary({
        authors: [author1, author2],
        total: 4,
        mine: true,
        currentUserId: 'u-me',
      })
    ).toBe('Вы, Алексей Иванов и ещё 2');
  });

  it('возвращает "Вы, Алексей Иванов и ещё 1", если остался 1', () => {
    expect(
      formatReactionAuthorsSummary({
        authors: [author1, author2],
        total: 3,
        mine: true,
        currentUserId: 'u-me',
      })
    ).toBe('Вы, Алексей Иванов и ещё 1');
  });

  it('возвращает одного чужого автора', () => {
    expect(
      formatReactionAuthorsSummary({
        authors: [author1],
        total: 1,
        mine: false,
      })
    ).toBe('Алексей Иванов');
  });

  it('возвращает двух чужих авторов через "и"', () => {
    expect(
      formatReactionAuthorsSummary({
        authors: [author1, author2],
        total: 2,
        mine: false,
      })
    ).toBe('Алексей Иванов и Мария Петрова');
  });

  it('возвращает "Алексей Иванов, Мария Петрова и ещё 3", если авторов много', () => {
    expect(
      formatReactionAuthorsSummary({
        authors: [author1, author2, author3],
        total: 5,
        mine: false,
      })
    ).toBe('Алексей Иванов, Мария Петрова и ещё 3');
  });
});

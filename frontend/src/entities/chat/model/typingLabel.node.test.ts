import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import i18n, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { chatKeys } from './chatKeys';
import { findKnownFirstName, formatTypingLabel } from './typingLabel';

const dictionary = (lang: string) =>
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../public/locales/${lang}/translation.json`),
      'utf-8'
    )
  ) as Record<string, string>;

// Настоящие словари: формы множественного числа проверяются по ним.
let ru: TFunction;
let en: TFunction;
beforeAll(async () => {
  const instance = i18n.createInstance();
  await instance.init({
    lng: 'ru',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: { ru: { translation: dictionary('ru') }, en: { translation: dictionary('en') } },
  });
  ru = instance.getFixedT('ru');
  en = instance.getFixedT('en');
});

describe('подпись «кто печатает» (#837)', () => {
  it('в группе: один, двое, несколько', () => {
    expect(formatTypingLabel(ru, true, ['Игорь'])).toBe('Игорь печатает…');
    expect(formatTypingLabel(ru, true, ['Игорь', 'Маша'])).toBe('Игорь и Маша печатают…');
    expect(formatTypingLabel(ru, true, ['Игорь', 'Маша', 'Вера'])).toBe('3 участника печатают…');
    expect(formatTypingLabel(ru, true, ['a', 'b', 'c', 'd', 'e'])).toBe('5 участников печатают…');
    expect(formatTypingLabel(en, true, ['Igor', 'Masha', 'Vera'])).toBe('3 members are typing…');
  });

  it('имя неизвестно — без имени, но не молча', () => {
    expect(formatTypingLabel(ru, true, [undefined])).toBe('Участник печатает…');
    // Двое, но одно имя неизвестно: «Игорь и Участник» читалось бы странно.
    expect(formatTypingLabel(ru, true, ['Игорь', undefined])).toBe('2 участника печатают…');
  });

  it('в личном чате собеседник один — без имени', () => {
    expect(formatTypingLabel(ru, false, ['Игорь'])).toBe('печатает...');
  });

  it('никто не печатает — подписи нет', () => {
    expect(formatTypingLabel(ru, true, [])).toBeNull();
  });
});

describe('имя печатающего без запросов к серверу (#837)', () => {
  const chat = { id: 'group', lastMessage: null };

  it('имя из события главнее всего', () => {
    const client = new QueryClient();
    client.setQueryData(chatKeys.members('group'), [
      { id: 'igor', firstName: 'Игорь-из-участников', username: 'igor' },
    ]);

    expect(findKnownFirstName(client, chat, { userId: 'igor', firstName: 'Игорь' })).toBe('Игорь');
  });

  it('из участников группы, если они уже загружены; без имени — логин', () => {
    const client = new QueryClient();
    client.setQueryData(chatKeys.members('group'), [
      { id: 'igor', firstName: 'Игорь', username: 'igor' },
      { id: 'nameless', firstName: '', username: 'ghost' },
    ]);

    expect(findKnownFirstName(client, chat, { userId: 'igor' })).toBe('Игорь');
    expect(findKnownFirstName(client, chat, { userId: 'nameless' })).toBe('ghost');
  });

  it('из ленты, если человек уже писал в открытый чат', () => {
    const client = new QueryClient();
    client.setQueryData(chatKeys.messages('group'), {
      pages: [[{ senderId: 'masha', senderFirstName: 'Маша', senderName: 'Маша Петрова' }]],
      pageParams: [0],
    });

    expect(findKnownFirstName(client, chat, { userId: 'masha' })).toBe('Маша');
  });

  it('из последнего сообщения в строке списка — только имя', () => {
    const client = new QueryClient();
    const withLast = {
      id: 'group',
      lastMessage: { senderId: 'vera', senderName: 'Вера Смирнова' },
    } as never;

    expect(findKnownFirstName(client, withLast, { userId: 'vera' })).toBe('Вера');
  });

  it('ничего не известно — undefined, запросов нет', () => {
    const client = new QueryClient();

    expect(findKnownFirstName(client, chat, { userId: 'stranger' })).toBeUndefined();
    // Кеш не тронут: подпись ничего не запрашивает.
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

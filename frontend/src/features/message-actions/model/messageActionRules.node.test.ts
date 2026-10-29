import { describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import type { IMediaItem } from '@/types';
import {
  availableMessageActions,
  canForwardMessage,
  type IMessageActionContext,
} from './messageActionRules';

const base: IMessageActionContext = {
  mine: true,
  place: 'thread',
  isPinned: false,
  canCopyImage: true,
};

const actions = (message: IMediaItem, context: Partial<IMessageActionContext> = {}) =>
  [...availableMessageActions(message, { ...base, ...context })].sort();

const photo = (extra: Partial<IMediaItem> = {}) =>
  makeMessage({
    type: 'image',
    content: '',
    mediaUrl: 'blob:photo',
    ...extra,
  } as never) as IMediaItem;

describe('состав меню сообщения (#655)', () => {
  it('своё текстовое — всё, кроме копирования медиа и перевода', () => {
    expect(actions(makeMessage({ content: 'привет' }))).toEqual(
      ['copyText', 'delete', 'edit', 'forward', 'pin', 'react', 'reply', 'select'].sort()
    );
  });

  it('чужое текстовое — перевод вместо правки', () => {
    const got = actions(makeMessage({ content: 'hello' }), { mine: false });
    expect(got).toContain('translate');
    expect(got).not.toContain('edit');
  });

  it('«Изменить» — не у голосового, стикера, GIF, звонка, пересланного и нерасшифрованного', () => {
    const cases: Partial<IMediaItem>[] = [
      { type: 'voice', content: '', mediaUrl: 'blob:v' },
      { type: 'sticker', content: '' },
      { type: 'gif', content: '' },
      { type: 'call', content: '' },
      { type: 'text', content: 'переслано', isForwarded: true },
      { type: 'text', content: '🔒', undecryptable: 'keyUnavailable' },
    ];
    for (const extra of cases) {
      expect(actions(makeMessage(extra as never)), JSON.stringify(extra)).not.toContain('edit');
    }
  });

  it('подпись к фото, видео и файлу можно изменить', () => {
    for (const type of ['image', 'video', 'file'] as const) {
      expect(actions(photo({ type, content: 'подпись' }))).toContain('edit');
    }
  });

  it('у голосового и стикера нечего копировать текстом', () => {
    expect(actions(makeMessage({ type: 'voice', content: '' } as never))).not.toContain('copyText');
    expect(actions(makeMessage({ type: 'sticker', content: 'sticker-id' } as never))).not.toContain(
      'copyText'
    );
  });

  it('фото с подписью: копировать текст, копировать изображение и сохранить', () => {
    const got = actions(photo({ content: 'закат' }));
    expect(got).toEqual(expect.arrayContaining(['copyText', 'copyImage', 'save']));
  });

  it('картинку в буфер — только если браузер умеет', () => {
    expect(actions(photo(), { canCopyImage: false })).not.toContain('copyImage');
  });

  it('недоступное медиа не сохраняется и не копируется', () => {
    const got = actions(photo({ mediaUnavailable: true }));
    expect(got).not.toContain('save');
    expect(got).not.toContain('copyImage');
  });

  it('видео, файл, аудио и голосовое сохраняются; стикер и GIF — нет', () => {
    for (const type of ['video', 'file', 'audio', 'voice'] as const) {
      expect(actions(photo({ type }))).toContain('save');
    }
    for (const type of ['sticker', 'gif'] as const) {
      expect(actions(photo({ type }))).not.toContain('save');
    }
  });

  it('неотправленное — только скопировать текст и удалить', () => {
    for (const status of ['pending', 'uploading', 'failed'] as const) {
      expect(actions(makeMessage({ content: 'в очереди', status }))).toEqual([
        'copyText',
        'delete',
      ]);
    }
  });

  it('закреплённое — «Открепить» вместо «Закрепить»', () => {
    const got = actions(makeMessage({ content: 'важно' }), { isPinned: true });
    expect(got).toContain('unpin');
    expect(got).not.toContain('pin');
  });

  it('в списке закреплённых нет ответа, правки, выбора и удаления', () => {
    const got = actions(makeMessage({ content: 'важно' }), { place: 'pinned', isPinned: true });
    expect(got).toEqual(['copyText', 'forward', 'react', 'unpin'].sort());
  });

  it('нерасшифрованное не пересылается и не копируется', () => {
    const got = actions(makeMessage({ content: '🔒', undecryptable: 'beforeJoin' }));
    expect(got).not.toContain('forward');
    expect(got).not.toContain('copyText');
  });

  it('показывает пункт просмотра реакций только если у сообщения есть реакции (#998)', () => {
    expect(actions(makeMessage({ content: 'без реакций' }))).not.toContain('viewReactions');
    expect(
      actions(
        makeMessage({
          content: 'с реакцией',
          reactions: [{ emoji: '👍', count: 1, myReaction: false }],
        } as never)
      )
    ).toContain('viewReactions');
  });
});

/* Пересылать можно только то, что сервер примет (#1061): звонок он от
   клиента не принимает, а вложение без файла уйти не может. */
describe('«Переслать» в меню сообщения (#1061)', () => {
  const sticker = (extra: Partial<IMediaItem> = {}) =>
    makeMessage({
      type: 'sticker',
      content: '',
      mediaUrl: '/api/v2/media/11111111-1111-4111-8111-111111111111',
      ...extra,
    } as never) as IMediaItem;

  it.each<[string, IMediaItem]>([
    ['звонок', makeMessage({ type: 'call', content: '{"status":"missed"}' }) as IMediaItem],
    ['фото, которое не открылось', photo({ mediaUnavailable: true })],
    ['фото без файла', photo({ mediaUrl: null })],
    ['стикер не из каталога', sticker({ mediaUrl: null, mediaUnavailable: true })],
  ])('нет у: %s', (_name, message) => {
    expect(actions(message)).not.toContain('forward');
    expect(canForwardMessage(message)).toBe(false);
  });

  it.each<[string, IMediaItem]>([
    ['текст', makeMessage({ content: 'привет' }) as IMediaItem],
    ['фото', photo()],
    ['голосовое', photo({ type: 'voice', mediaUrl: 'blob:voice' })],
    ['стикер из каталога', sticker()],
    ['GIF из каталога', sticker({ type: 'gif' })],
  ])('есть у: %s', (_name, message) => {
    expect(actions(message)).toContain('forward');
    expect(canForwardMessage(message)).toBe(true);
  });

  it('неотправленное не пересылается', () => {
    expect(canForwardMessage(makeMessage({ content: 'ещё в пути', status: 'pending' }))).toBe(
      false
    );
  });
});

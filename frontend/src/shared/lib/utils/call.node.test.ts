import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { describeCallMessage, formatCallPreview } from './call';

/** Перевод запасными строками — как в интерфейсе до загрузки словаря. */
const t = ((_key: string, options?: string | { defaultValue?: string; seconds?: number }) => {
  if (typeof options === 'string') return options;
  return (options?.defaultValue ?? _key).replace('{{seconds}}', String(options?.seconds ?? ''));
}) as unknown as TFunction;

const ME = 'user-1';
const PEER = 'user-2';
const call = (fields: Record<string, unknown>) => JSON.stringify(fields);

/* Тип и итог звонка в ленте и в превью (#1073): сервер пишет вид, итог и
   звонившего, а клиент прежде читал только длительность. */
describe('сообщение-звонок', () => {
  it('исходящий отвеченный аудио — «Исходящий звонок · 1:05»', () => {
    const content = call({ callKind: 'audio', status: 'answered', duration: 65, initiatorId: ME });

    expect(formatCallPreview(content, t, { senderId: ME, viewerId: ME })).toBe(
      'Исходящий звонок · 1:05'
    );
  });

  it('входящий отвеченный видео меньше минуты — «Входящий видеозвонок · 28 сек»', () => {
    const content = call({
      callKind: 'video',
      status: 'answered',
      duration: 28,
      initiatorId: PEER,
    });

    expect(formatCallPreview(content, t, { senderId: PEER, viewerId: ME })).toBe(
      'Входящий видеозвонок · 28 сек'
    );
  });

  it('входящий missed — «Пропущенный звонок», без второй строки', () => {
    const content = call({ callKind: 'audio', status: 'missed', duration: 0, initiatorId: PEER });

    expect(formatCallPreview(content, t, { senderId: PEER, viewerId: ME })).toBe(
      'Пропущенный звонок'
    );
  });

  it('исходящий missed видео — «Исходящий видеозвонок · Без ответа»', () => {
    const content = call({ callKind: 'video', status: 'missed', initiatorId: ME });

    expect(formatCallPreview(content, t, { senderId: ME, viewerId: ME })).toBe(
      'Исходящий видеозвонок · Без ответа'
    );
  });

  it('без status — по длительности', () => {
    expect(describeCallMessage(call({ duration: 28 }), PEER, ME).answered).toBe(true);
    expect(describeCallMessage(call({ duration: 0 }), PEER, ME).answered).toBe(false);
  });

  it('неизвестный status — неотвеченный', () => {
    expect(describeCallMessage(call({ status: 'weird', duration: 40 }), PEER, ME)).toMatchObject({
      answered: false,
      durationSeconds: 0,
    });
  });

  it.each(['', '{', null])(
    'битый content «%s» — пропущенный аудиозвонок без исключения',
    (content) => {
      expect(formatCallPreview(content, t, { senderId: PEER, viewerId: ME })).toBe(
        'Пропущенный звонок'
      );
    }
  );

  it('без initiatorId — направление по отправителю', () => {
    expect(describeCallMessage(call({ status: 'answered' }), ME, ME).direction).toBe('outgoing');
    expect(describeCallMessage(call({ status: 'answered' }), PEER, ME).direction).toBe('incoming');
  });
});

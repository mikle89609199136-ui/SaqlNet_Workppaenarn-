import type { TFunction } from 'i18next';
import { describeDayTime, type IDayTimeOptions } from '@/shared/lib';
import type { IMessageDto, TMessagesList } from './types';

export const hasMessageMedia = (msg: IMessageDto) => !!(msg.mediaUrl || msg.mediaUnavailable);

/**
 * Сообщение ещё не подтверждено сервером: в пути, грузится или не ушло.
 *
 * Его id временный, сервер такого не знает. Поэтому оно не пересылается и
 * не закрепляется (меню действий, #655), не попадает в отметку прочтения
 * (#1067) и не убирается из ленты, если его нет в ответе сервера.
 */
export function isUnsent(message: Pick<IMessageDto, 'id' | 'status' | 'tempId'>): boolean {
  return (
    message.status === 'pending' ||
    message.status === 'uploading' ||
    message.status === 'failed' ||
    Boolean(message.tempId) ||
    message.id.startsWith('temp-')
  );
}

export const formatMessageTime = (value: Date | string) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
};

/**
 * «Изменено сегодня в 21:05» (#1066): у пузыря видно только «изменено», а
 * поправить могли и до моего ответа, и после.
 *
 * Время правки — `updatedAt`: сервер меняет его только правкой. Если
 * появится отдельное `editedAt` (#711), меняется только эта функция.
 */
export function formatEditedAt(
  message: Pick<IMessageDto, 'isEdited' | 'updatedAt'>,
  t: TFunction,
  options: IDayTimeOptions = {}
): string | null {
  if (!message.isEdited || !message.updatedAt) return null;
  const date = message.updatedAt instanceof Date ? message.updatedAt : new Date(message.updatedAt);
  if (Number.isNaN(date.getTime())) return null;

  const { day, time, date: onDate } = describeDayTime(date, options);
  if (day === 'today') {
    return t('editedAt.today', { time, defaultValue: 'Изменено сегодня в {{time}}' });
  }
  if (day === 'yesterday') {
    return t('editedAt.yesterday', { time, defaultValue: 'Изменено вчера в {{time}}' });
  }
  return t('editedAt.onDate', { date: onDate, time, defaultValue: 'Изменено {{date}} в {{time}}' });
}

export function getMessagePreview(message: IMessageDto | null) {
  if (!message) return '';
  return String(message.content || '').slice(0, 64);
}

export function appendUniqueMessage(items: TMessagesList, nextMessage: IMessageDto) {
  if (items.some((message) => message.id === nextMessage.id)) return items;
  return [...items, nextMessage];
}

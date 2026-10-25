import i18n from 'i18next';
import type { TFunction } from 'i18next';
import { describeDayTime, type IDayTimeOptions } from './dayTime';

/**
 * Доставка и прочтение своих сообщений (#657).
 *
 * Время ставит сервер: `deliveredAt` и `readAt` приходят у своих сообщений
 * в ленте и у последнего сообщения в списке чатов, а сдвиг границы
 * собеседника — событием `receipts`: его сообщения до `upTo` включительно
 * доставлены или прочитаны в момент `at`.
 */

export type TReceiptState = 'sent' | 'delivered' | 'read';

export type TReceiptKind = 'delivered' | 'read';

export interface IReceiptTimes {
  deliveredAt?: string;
  readAt?: string;
}

export interface IReceiptEvent {
  chatId: string;
  /** Чья граница сдвинулась — собеседник, а не автор. */
  userId: string;
  kind: TReceiptKind;
  upTo: string;
  at: string;
}

/** Прочитанное — доставлено, даже если о доставке отдельно не сообщали. */
export function receiptState({ deliveredAt, readAt }: IReceiptTimes): TReceiptState {
  if (readAt) return 'read';
  if (deliveredAt) return 'delivered';
  return 'sent';
}

function toTime(value: Date | string | undefined): number {
  if (!value) return Number.NaN;
  return (value instanceof Date ? value : new Date(value)).getTime();
}

/**
 * Переходит ли граница `upTo` сообщение, созданное в `createdAt`.
 *
 * Сервер отдаёт `upTo` с миллисекундами, отбрасывая микросекунды, а время
 * сообщения приходит с микросекундами, и браузер тоже их отбрасывает. Так
 * что сообщение, до которого дошла граница, не оказывается «позже» неё.
 */
export function isCoveredBy(createdAt: Date | string | undefined, upTo: string): boolean {
  const created = toTime(createdAt);
  const boundary = toTime(upTo);
  return Number.isFinite(created) && Number.isFinite(boundary) && created <= boundary;
}

/**
 * Время из события — полю сообщения. Уже известное время не трогается: оно
 * первое, а граница только растёт. Прочтение заодно ставит доставку.
 * Возвращает `null`, если менять нечего.
 */
export function receiptPatch(
  current: IReceiptTimes,
  kind: TReceiptKind,
  at: string
): IReceiptTimes | null {
  const patch: IReceiptTimes = {};
  if (kind === 'read' && !current.readAt) patch.readAt = at;
  if (!current.deliveredAt) patch.deliveredAt = at;
  return Object.keys(patch).length ? patch : null;
}

export type IFormatReceiptOptions = IDayTimeOptions;

/**
 * «Прочитано сегодня в 21:05», «Доставлено вчера в 18:40», «Прочитано
 * 25 сентября в 12:30» — в часовом поясе и языке человека; год — если не
 * этот. Для «отправлено» строки нет: время отправки видно на сообщении.
 */
export function formatReceipt(
  times: IReceiptTimes,
  t: TFunction,
  { now = new Date(), locale = i18n.language || 'ru' }: IFormatReceiptOptions = {}
): string | null {
  const state = receiptState(times);
  if (state === 'sent') return null;
  const date = new Date((state === 'read' ? times.readAt : times.deliveredAt) ?? '');
  if (Number.isNaN(date.getTime())) return null;

  const { day: when, time, date: day } = describeDayTime(date, { now, locale });
  const read = state === 'read';
  if (when === 'today') {
    return read
      ? t('receipt.readToday', { time, defaultValue: 'Прочитано сегодня в {{time}}' })
      : t('receipt.deliveredToday', { time, defaultValue: 'Доставлено сегодня в {{time}}' });
  }

  if (when === 'yesterday') {
    return read
      ? t('receipt.readYesterday', { time, defaultValue: 'Прочитано вчера в {{time}}' })
      : t('receipt.deliveredYesterday', { time, defaultValue: 'Доставлено вчера в {{time}}' });
  }

  return read
    ? t('receipt.readOnDate', { date: day, time, defaultValue: 'Прочитано {{date}} в {{time}}' })
    : t('receipt.deliveredOnDate', {
        date: day,
        time,
        defaultValue: 'Доставлено {{date}} в {{time}}',
      });
}

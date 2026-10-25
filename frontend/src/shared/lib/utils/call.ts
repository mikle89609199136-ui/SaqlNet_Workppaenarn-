import type { TFunction } from 'i18next';

export const parseCallContent = (content: string) => {
  if (!content || typeof content !== 'string') return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
};

/** Длительность звонка: «1:05» или, если меньше минуты, «28 сек» на языке интерфейса. */
export const formatCallDuration = (seconds: number, t: TFunction) => {
  const total = Number(seconds) || 0;
  if (total <= 0) return '';
  const mins = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return mins
    ? `${mins}:${rest}`
    : t('call.durationSeconds', { seconds: total % 60, defaultValue: '{{seconds}} сек' });
};

/** Что известно о звонке из сообщения о нём — с точки зрения того, кто смотрит. */
export interface ICallMessageInfo {
  kind: 'audio' | 'video';
  direction: 'incoming' | 'outgoing';
  answered: boolean;
  /** У неотвеченного — 0. */
  durationSeconds: number;
}

/**
 * Разобрать сообщение-звонок (#1073).
 *
 * Сервер кладёт в `content` вид, итог и звонившего, но клиент читал
 * только длительность: пропущенный выглядел так же, как состоявшийся, и не
 * было видно, кто кому звонил. Итога сервер знает два — `answered` и
 * `missed`; неизвестный считается неотвеченным, без `status` судим по
 * длительности. Битый `content` — неотвеченный аудиозвонок, без исключений.
 */
export function describeCallMessage(
  content: string | null | undefined,
  senderId: string | undefined,
  viewerId: string | undefined
): ICallMessageInfo {
  const parsed = parseCallContent(content ?? '');
  const duration = Number(parsed.duration) || 0;
  const answered = typeof parsed.status === 'string' ? parsed.status === 'answered' : duration > 0;
  const initiator =
    typeof parsed.initiatorId === 'string' && parsed.initiatorId ? parsed.initiatorId : senderId;

  return {
    kind: parsed.callKind === 'video' ? 'video' : 'audio',
    direction: viewerId && initiator === viewerId ? 'outgoing' : 'incoming',
    answered,
    durationSeconds: answered ? duration : 0,
  };
}

/** «Входящий видеозвонок», «Пропущенный звонок»… */
export function formatCallTitle(info: ICallMessageInfo, t: TFunction): string {
  const video = info.kind === 'video';
  if (info.direction === 'incoming' && !info.answered) {
    return video
      ? t('call.message.missedVideo', 'Пропущенный видеозвонок')
      : t('call.message.missed', 'Пропущенный звонок');
  }
  if (info.direction === 'incoming') {
    return video
      ? t('call.message.incomingVideo', 'Входящий видеозвонок')
      : t('call.message.incoming', 'Входящий звонок');
  }
  return video
    ? t('call.message.outgoingVideo', 'Исходящий видеозвонок')
    : t('call.message.outgoing', 'Исходящий звонок');
}

/**
 * Вторая строка: длительность у состоявшегося, «Без ответа» у неотвеченного
 * исходящего. Не «Отклонён» и не «Отменён»: сервер не сообщает, отказал ли
 * собеседник или звонящий положил трубку сам.
 */
export function formatCallDetail(info: ICallMessageInfo, t: TFunction): string {
  if (info.answered) return formatCallDuration(info.durationSeconds, t);
  if (info.direction === 'outgoing') return t('call.message.noAnswer', 'Без ответа');
  return '';
}

/**
 * Превью звонка в списке чатов и в уведомлении: «Пропущенный звонок»,
 * «Исходящий звонок · Без ответа», «Входящий видеозвонок · 1:05» (#1073).
 *
 * Собирается там, где известен язык, — раньше это делал сервис расшифровки
 * превью, и строка оставалась русской в английском интерфейсе.
 */
export function formatCallPreview(
  content: string | null | undefined,
  t: TFunction,
  { senderId, viewerId }: { senderId?: string; viewerId?: string } = {}
): string {
  const info = describeCallMessage(content, senderId, viewerId);
  const title = formatCallTitle(info, t);
  const detail = formatCallDetail(info, t);
  return detail ? `${title} · ${detail}` : title;
}

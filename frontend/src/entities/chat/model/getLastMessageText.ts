import type { ILastMessageDto } from './types';
import type { TFunction } from 'i18next';
import { formatCallPreview } from '@/shared/lib';

/**
 * `viewerId` — кто смотрит: звонок от него исходящий, от собеседника —
 * входящий или пропущенный (#1073).
 */
export function getLastMessageText(
  lastMessage: ILastMessageDto | undefined,
  t: TFunction,
  viewerId?: string
) {
  if (!lastMessage) return t('noMessages', 'Нет сообщений');

  /* Нечитаемое сообщение подписывается здесь: причину назвал слой
     шифрования, а язык знает интерфейс. Запасное значение — тот самый
     текст, что пришёл из сервиса. */
  if (lastMessage.undecryptable) {
    return `🔒 ${t(`undecryptable.${lastMessage.undecryptable}`, lastMessage.content)}`;
  }

  /* Звонок хранит в содержимом служебный JSON (вид, итог, длительность) —
     подпись собирается здесь, на языке интерфейса. */
  if (lastMessage.type === 'call') {
    return formatCallPreview(lastMessage.content, t, { senderId: lastMessage.senderId, viewerId });
  }

  if (lastMessage.content) return lastMessage.content;

  if (lastMessage.type === 'image') return t('lastMessage.image', 'Фотография');
  if (lastMessage.type === 'audio') return t('lastMessage.audio', 'Аудио');
  if (lastMessage.type === 'file') return t('lastMessage.file', 'Файл');
  if (lastMessage.type === 'gif') return t('lastMessage.gif', 'Гиф');
  if (lastMessage.type === 'sticker') return t('lastMessage.sticker', 'Стикер');
  if (lastMessage.type === 'video') return t('lastMessage.video', 'Видео');
  if (lastMessage.type === 'voice') return t('lastMessage.voice', 'Голосовое сообщение');
}

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { chatKeys } from './chatKeys';
import { useTypingStore, type ITypingUser } from './typingStore';
import type { IChatDto, TMembersList } from './types';

/*
 * Подпись «кто печатает» (#837).
 *
 * Имя берётся без запросов к серверу: из самого события (#866), а пока
 * сервер его не шлёт — из того, что уже лежит в кеше. Запрашивать профиль
 * ради трёхсекундной подписи незачем: не нашлось — «Участник печатает…».
 */

/** Автор в ленте — ровно те поля, что нужны здесь; тип ленты — у сущности сообщения. */
interface IKnownSender {
  senderId?: string;
  senderFirstName?: string;
  senderName?: string;
}

const firstWord = (value?: string) => value?.trim().split(/\s+/)[0] || undefined;

/** Имя печатающего из уже загруженных данных — без запросов. */
export function findKnownFirstName(
  queryClient: QueryClient,
  chat: Pick<IChatDto, 'id' | 'lastMessage'>,
  typer: ITypingUser
): string | undefined {
  if (typer.firstName) return typer.firstName;

  const members = queryClient.getQueryData<TMembersList>(chatKeys.members(chat.id));
  const member = members?.find((item) => item.id === typer.userId);
  if (member) return member.firstName || member.username;

  // Лента хранится страницами; ключ общий с сущностью сообщения.
  const thread = queryClient.getQueryData<{ pages?: IKnownSender[][] }>(chatKeys.messages(chat.id));
  for (const page of thread?.pages ?? []) {
    const message = page.find((item) => item.senderId === typer.userId);
    if (message) return message.senderFirstName || firstWord(message.senderName);
  }

  if (chat.lastMessage?.senderId === typer.userId) return firstWord(chat.lastMessage.senderName);
  return undefined;
}

/**
 * «Игорь печатает…», «Игорь и Маша печатают…», «3 участника печатают…».
 * В личном чате собеседник один — просто «печатает…».
 */
export function formatTypingLabel(
  t: TFunction,
  isGroup: boolean,
  names: (string | undefined)[]
): string | null {
  if (names.length === 0) return null;
  if (!isGroup) return t('typing', 'печатает...');

  const [first, second] = names;
  if (names.length === 1) {
    return first
      ? t('typingOne', { name: first, defaultValue: '{{name}} печатает…' })
      : t('typingSomeone', 'Участник печатает…');
  }
  if (names.length === 2 && first && second) {
    return t('typingTwo', { first, second, defaultValue: '{{first}} и {{second}} печатают…' });
  }
  return t('typingMany', { count: names.length, defaultValue: '{{count}} участника печатают…' });
}

/** Кто печатает в этом чате — готовой подписью или `null`. */
export function useTypingLabel(
  chat: Pick<IChatDto, 'id' | 'type' | 'lastMessage'> | undefined
): string | null {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const typers = useTypingStore((state) => (chat ? state.typingByChat[chat.id] : undefined));

  if (!chat || !typers) return null;
  const names = typers.map((typer) => findKnownFirstName(queryClient, chat, typer));
  return formatTypingLabel(t, chat.type === 'group', names);
}

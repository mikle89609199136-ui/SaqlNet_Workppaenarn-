import type { IChatDto, IMemberDto } from './types';

/**
 * Кто умеет доставать чат.
 *
 * Шифрование каждой операции требует данных чата — типа и ключа
 * собеседника. Эти данные уже лежат в кеше запросов, но импортировать его
 * из слоя сервисов нельзя: запросы вызывают сервисы, и получился бы цикл,
 * на котором падает проверка сборки.
 *
 * Поэтому зависимость перевёрнута: здесь объявлено только то, что чат
 * кто-то умеет доставать, а реализацию регистрирует слой запросов при
 * старте приложения.
 */
export type TChatResolver = (chatId: string) => Promise<IChatDto>;

let resolver: TChatResolver | null = null;

export function setChatResolver(next: TChatResolver | null): void {
  resolver = next;
}

export function resolveChat(chatId: string): Promise<IChatDto> {
  if (!resolver) {
    // Обращение до старта приложения означает ошибку в порядке
    // инициализации, а не отсутствие данных: молчать здесь нельзя —
    // без чата операция шифрования всё равно не состоится.
    return Promise.reject(new Error('Источник данных чата не зарегистрирован'));
  }

  return resolver(chatId);
}

/**
 * Кто умеет доставать участников чата.
 *
 * Шифрование заворачивает ключ чата отдельно для каждого участника, а
 * список участников живёт в кеше запросов. Зависимость перевёрнута по той
 * же причине, что и для самого чата: слой сервисов не должен знать про
 * слой запросов.
 */
export type TMembersResolver = (chatId: string) => Promise<IMemberDto[]>;

let membersResolver: TMembersResolver | null = null;

export function setMembersResolver(next: TMembersResolver | null): void {
  membersResolver = next;
}

export function resolveMembers(chatId: string): Promise<IMemberDto[]> {
  if (!membersResolver) {
    return Promise.reject(new Error('Источник участников чата не зарегистрирован'));
  }

  return membersResolver(chatId);
}

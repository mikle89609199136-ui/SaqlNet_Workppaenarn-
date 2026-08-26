import type { IChatDto } from '@/types';

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

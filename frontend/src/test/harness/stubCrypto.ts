import { vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import type { IMessageEntity, IRichText } from '@/shared/lib/richText';

/**
 * Подмена шифрования для тестов интерфейса.
 *
 * Настоящий WebCrypto в jsdom работает не везде: под Node 20 он отвергает
 * буферы, созданные вне своего realm, и любая операция падает с TypeError.
 * Локально на Node 22 это незаметно, в CI — нет.
 *
 * Поэтому криптографический контракт проверяется там, где криптография
 * действительно выполняется, — в файлах `*.node.test.ts`, а тестам страницы
 * достаточно, чтобы содержимое на проводе отличалось от того, что видит
 * пользователь. Подмена сохраняет ровно это свойство и готовность ключа.
 */

const ENVELOPE_MARKER = 'e2e-stub';

/* Форматирование (#656) едет внутри конверта, как в настоящем v3. */
function encode(text: string, entities: IMessageEntity[]): string {
  return JSON.stringify({
    v: entities.length > 0 ? 3 : 2,
    epoch: 1,
    marker: ENVELOPE_MARKER,
    ct: Buffer.from(JSON.stringify({ text, entities }), 'utf8').toString('base64'),
  });
}

function decode(payload: string): IRichText {
  try {
    const parsed = JSON.parse(payload);
    if (parsed?.marker !== ENVELOPE_MARKER) return { text: payload, entities: [] };
    return JSON.parse(Buffer.from(parsed.ct, 'base64').toString('utf8')) as IRichText;
  } catch {
    // Не конверт — значит содержимое не шифровали, отдаём как есть.
    return { text: payload, entities: [] };
  }
}

export interface IStubCryptoOptions {
  /** Ключ чата не готов: так выглядит чат, где шифровать пока нечем. */
  keyUnavailable?: boolean;
}

export function stubCrypto({ keyUnavailable = false }: IStubCryptoOptions = {}): void {
  const ready = {
    chatKey: keyUnavailable ? null : { key: new Uint8Array(32), epoch: 1 },
    membersWithoutIdentity: [],
  };

  vi.spyOn(services.cryptoService, 'ensureChatKey').mockResolvedValue(ready);
  vi.spyOn(services.cryptoService, 'healChatKeys').mockResolvedValue(ready);
  vi.spyOn(services.cryptoService, 'rotateChatKey').mockResolvedValue(ready);

  vi.spyOn(services.cryptoService, 'encryptMessage').mockImplementation(
    async (_chatId: string, text: string, entities: IMessageEntity[] = []) => {
      if (keyUnavailable) {
        throw new Error('Ключ шифрования чата недоступен — сообщение не отправлено');
      }

      return text ? encode(text, entities) : text;
    }
  );

  vi.spyOn(services.cryptoService, 'decryptMessage').mockImplementation(
    async (_chatId: string, payload: string) => decode(payload)
  );
}

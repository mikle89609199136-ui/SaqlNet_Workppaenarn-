import { vi } from 'vitest';
import { services } from '@/services/serviceContainer';

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
 * пользователь. Подмена сохраняет ровно это свойство и отказ при отсутствии
 * ключа собеседника.
 */

const ENVELOPE_MARKER = 'e2e-stub';

function encode(content: string): string {
  return JSON.stringify({
    e2e: true,
    marker: ENVELOPE_MARKER,
    data: Buffer.from(content, 'utf8').toString('base64'),
  });
}

function decode(payload: string): string {
  try {
    const parsed = JSON.parse(payload);
    if (parsed?.marker !== ENVELOPE_MARKER) return payload;
    return Buffer.from(parsed.data, 'base64').toString('utf8');
  } catch {
    // Не конверт — значит содержимое не шифровали, отдаём как есть.
    return payload;
  }
}

export function stubCrypto(): void {
  vi.spyOn(services.cryptoService, 'encryptDM').mockImplementation(
    async (content: string, recipientPubKeyB64: string) => {
      if (!content) return content;
      // Поведение настоящего сервиса: без ключа собеседника шифровать нечем,
      // и отправлять открытый текст вместо этого нельзя.
      if (!recipientPubKeyB64) {
        throw new Error('У собеседника нет ключа шифрования — сообщение не отправлено');
      }
      return encode(content);
    }
  );

  vi.spyOn(services.cryptoService, 'decryptDM').mockImplementation(async (payload: string) =>
    decode(payload)
  );
}

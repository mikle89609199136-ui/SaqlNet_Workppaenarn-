import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptMediaBytes,
  decryptMessage,
  encryptMediaBytes,
  encryptMessage,
  forgetDerivedKeys,
  isLegacyContent,
  parseEnvelope,
} from './envelope';
import { utf8ToBytes } from './encoding';

const CHAT = 'chat-1';
const SENDER = 'user-1';
const EPOCH = 3;

function chatKey(seed = 7): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

beforeEach(() => {
  forgetDerivedKeys();
});

describe('конверт сообщения', () => {
  it('should return the same text it was given', async () => {
    const key = chatKey();
    const payload = await encryptMessage(key, CHAT, EPOCH, SENDER, 'привет');
    const envelope = parseEnvelope(payload);

    expect(envelope).not.toBeNull();
    expect(await decryptMessage(key, CHAT, SENDER, envelope!)).toBe('привет');
  });

  it('should not carry the text anywhere in the payload', async () => {
    const secret = 'совершенно-секретная-строка';
    const payload = await encryptMessage(chatKey(), CHAT, EPOCH, SENDER, secret);

    expect(payload).not.toContain(secret);
  });

  it('should look different every time', async () => {
    // Одинаковый шифртекст на одинаковый текст выдавал бы содержимое
    // сообщения любому, кто видит переписку целиком.
    const key = chatKey();
    const first = parseEnvelope(await encryptMessage(key, CHAT, EPOCH, SENDER, 'да'))!;
    const second = parseEnvelope(await encryptMessage(key, CHAT, EPOCH, SENDER, 'да'))!;

    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
  });

  it('should refuse to open in another chat', async () => {
    // Идентификатор чата входит в проверяемые данные: перевесить шифртекст
    // в другой чат сервер не может.
    const key = chatKey();
    const envelope = parseEnvelope(await encryptMessage(key, CHAT, EPOCH, SENDER, 'привет'))!;

    await expect(decryptMessage(key, 'chat-2', SENDER, envelope)).rejects.toThrow();
  });

  it('should refuse to open under another sender', async () => {
    // Автор входит в проверяемые данные: переписать отправителя нельзя.
    const key = chatKey();
    const envelope = parseEnvelope(await encryptMessage(key, CHAT, EPOCH, SENDER, 'привет'))!;

    await expect(decryptMessage(key, CHAT, 'user-2', envelope)).rejects.toThrow();
  });

  it('should refuse to open under another epoch', async () => {
    const key = chatKey();
    const envelope = parseEnvelope(await encryptMessage(key, CHAT, EPOCH, SENDER, 'привет'))!;

    await expect(
      decryptMessage(key, CHAT, SENDER, { ...envelope, epoch: EPOCH + 1 })
    ).rejects.toThrow();
  });

  it('should refuse to open with another chat key', async () => {
    const envelope = parseEnvelope(
      await encryptMessage(chatKey(1), CHAT, EPOCH, SENDER, 'привет')
    )!;

    await expect(decryptMessage(chatKey(2), CHAT, SENDER, envelope)).rejects.toThrow();
  });

  it('should notice a tampered ciphertext', async () => {
    const key = chatKey();
    const envelope = parseEnvelope(await encryptMessage(key, CHAT, EPOCH, SENDER, 'привет'))!;
    /* Символ подменяется на заведомо другой, а не всегда на «A»: у
       случайного шифротекста первый символ и сам оказывается «A»
       примерно в одном прогоне из шестидесяти четырёх — тогда конверт
       остаётся целым, расшифровка честно проходит, и падает тест, а не
       проверяемый код. */
    const head = envelope.data[0] === 'A' ? 'B' : 'A';
    const broken = { ...envelope, data: `${head}${envelope.data.slice(1)}` };

    await expect(decryptMessage(key, CHAT, SENDER, broken)).rejects.toThrow();
  });
});

describe('конверт файла', () => {
  it('should return the same bytes it was given', async () => {
    const key = chatKey();
    const bytes = utf8ToBytes('содержимое файла').buffer as ArrayBuffer;

    const { iv, ciphertext } = await encryptMediaBytes(key, CHAT, EPOCH, bytes);
    const restored = await decryptMediaBytes(key, CHAT, EPOCH, iv, ciphertext);

    expect(new TextDecoder().decode(restored)).toBe('содержимое файла');
  });

  it('should use a key of its own, not the one messages use', async () => {
    // Один ключ на всё означал бы, что утечка в одном месте открывает и
    // другое. Из ключа чата выводятся независимые подключи.
    const key = chatKey();
    const bytes = utf8ToBytes('файл').buffer as ArrayBuffer;
    const { iv, ciphertext } = await encryptMediaBytes(key, CHAT, EPOCH, bytes);

    // Тот же шифртекст, прочитанный как сообщение, не открывается.
    await expect(
      decryptMessage(key, CHAT, SENDER, { v: 2, e2e: true, epoch: EPOCH, iv, data: ciphertext })
    ).rejects.toThrow();
  });
});

describe('распознавание формата', () => {
  it('should recognise the base64 that pretended to be group encryption', () => {
    expect(isLegacyContent('[MLS]0L/RgNC40LLQtdGC')).toBe(true);
  });

  it('should recognise the previous message format', () => {
    expect(isLegacyContent(JSON.stringify({ e2e: true, iv: 'x', data: 'y' }))).toBe(true);
  });

  it('should not mistake the current format for the previous one', async () => {
    const payload = await encryptMessage(chatKey(), CHAT, EPOCH, SENDER, 'привет');

    expect(isLegacyContent(payload)).toBe(false);
    expect(parseEnvelope(payload)).not.toBeNull();
  });

  it('should leave plain text alone', () => {
    expect(parseEnvelope('обычный текст')).toBeNull();
    expect(isLegacyContent('обычный текст')).toBe(false);
  });

  it('should reject a malformed envelope', () => {
    expect(parseEnvelope('{"v":2,"epoch":"не число"}')).toBeNull();
    expect(parseEnvelope('{сломанный json')).toBeNull();
  });

  it('should carry the fields the server looks for', async () => {
    // Сервер оставляет содержимое нетронутым, только если видит e2e, iv и
    // data. Без них он экранирует кавычки, и конверт перестаёт быть JSON:
    // на живом стенде сообщение доходило до собеседника в виде «{&#34;v&#34;…».
    const payload = JSON.parse(await encryptMessage(chatKey(), CHAT, EPOCH, SENDER, 'привет'));

    expect(payload.e2e).toBe(true);
    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.data).toBe('string');
  });
});

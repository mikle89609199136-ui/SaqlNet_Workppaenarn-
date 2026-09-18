import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '@/shared/api/ApiClient';
import { useMemoryKeyStore } from '@/shared/crypto';
import type { IEncryptedMedia } from '@/types';
import {
  CryptoService,
  KEY_UNAVAILABLE_PLACEHOLDER,
  LEGACY_MESSAGE_PLACEHOLDER,
} from './CryptoService';

/**
 * Разбор того, что пришло с сервера.
 *
 * Здесь проверяется не криптография, а поведение на негодных данных: они
 * приходят снаружи, и приведение типа не спасает. Ошибиться нужно понятно
 * и до начала криптографической операции, иначе «данные не те» выглядит
 * как «файл не открылся».
 */

function createService(): CryptoService {
  const apiClient = {
    get: async () => ({ data: {} }),
    post: async () => ({ data: {} }),
  } as unknown as ApiClient;

  return new CryptoService(apiClient);
}

beforeEach(() => {
  useMemoryKeyStore();
  localStorage.clear();
});

describe('разбор входящего сообщения', () => {
  it('should leave plain text as it is', async () => {
    // Каналы не шифруются, и их сообщения проходят насквозь.
    const { text, senderVerified } = await createService().decryptMessage(
      'chat-1',
      'обычный текст',
      'user-2'
    );

    expect(text).toBe('обычный текст');
    expect(senderVerified).toBeUndefined();
  });

  it('should refuse to read a message of the previous scheme', async () => {
    // В прежнем формате ключ отправителя брался из самого сообщения: за
    // подлинность такого текста никто не отвечает, поэтому он не читается.
    const legacy = JSON.stringify({ e2e: true, iv: 'x', data: 'y' });

    expect((await createService().decryptMessage('chat-1', legacy, 'user-2')).text).toBe(
      LEGACY_MESSAGE_PLACEHOLDER
    );
  });

  it('should refuse to read the base64 that pretended to be group encryption', async () => {
    expect(
      (await createService().decryptMessage('chat-1', '[MLS]0YLQtdC60YHRgg==', 'u')).text
    ).toBe(LEGACY_MESSAGE_PLACEHOLDER);
  });

  it('should say the key is missing instead of failing', async () => {
    // Конверт нынешнего формата, но ключа этой эпохи на устройстве нет и
    // взять его неоткуда: сообщение показывается заглушкой, а не роняет ленту.
    localStorage.setItem('craneapp_user_data', JSON.stringify({ id: 'user-1' }));
    const envelope = JSON.stringify({
      v: 2,
      e2e: true,
      epoch: 7,
      iv: 'AAECAwQFBgcICQoL',
      data: 'c2hpZnJ0ZWtzdA==',
    });

    expect((await createService().decryptMessage('chat-1', envelope, 'user-2')).text).toBe(
      KEY_UNAVAILABLE_PLACEHOLDER
    );
  });
});

describe('разбор зашифрованного файла', () => {
  it('should name the previous format by name', async () => {
    const legacy = { encrypted: true, version: 1, algorithm: 'AES-GCM', iv: 'x', ciphertext: 'y' };

    await expect(
      createService().decryptMedia('chat-1', legacy as unknown as IEncryptedMedia)
    ).rejects.toThrow(/устаревшем формате/);
  });

  it('should refuse a payload with fields missing', async () => {
    const broken = { encrypted: true, version: 2, algorithm: 'AES-GCM' };

    await expect(
      createService().decryptMedia('chat-1', broken as unknown as IEncryptedMedia)
    ).rejects.toThrow(/Ожидался зашифрованный файл/);
  });

  it('should refuse something that is not a payload at all', async () => {
    await expect(
      createService().decryptMedia('chat-1', 'строка' as unknown as IEncryptedMedia)
    ).rejects.toThrow(/Ожидался зашифрованный файл/);
  });
});

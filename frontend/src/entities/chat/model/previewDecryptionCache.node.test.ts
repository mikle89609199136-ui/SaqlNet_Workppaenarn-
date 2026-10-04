import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILastMessageDto } from './types';
import { decryptPreviewOnce, forgetDecryptedPreviews } from './previewDecryptionCache';

const message = (overrides: Partial<ILastMessageDto> = {}) =>
  ({
    id: 'm-1',
    content: 'шифртекст-1',
    type: 'text',
    senderId: 'u-2',
    senderName: 'Анна',
    reactions: [],
    ...overrides,
  }) as ILastMessageDto;

const decryptor = () =>
  vi.fn(async (_chatId: string, preview: ILastMessageDto) => ({
    ...preview,
    content: `открытый: ${preview.content}`,
  }));

describe('расшифрованные превью списка чатов (#899)', () => {
  beforeEach(() => {
    forgetDecryptedPreviews();
  });

  it('то же сообщение расшифровывается один раз', async () => {
    const decrypt = decryptor();

    await decryptPreviewOnce('c-1', message(), decrypt);
    const again = await decryptPreviewOnce('c-1', message(), decrypt);

    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(again.content).toBe('открытый: шифртекст-1');
  });

  it('изменённое сообщение — новый шифртекст — расшифровывается заново', async () => {
    const decrypt = decryptor();

    await decryptPreviewOnce('c-1', message(), decrypt);
    const edited = await decryptPreviewOnce('c-1', message({ content: 'шифртекст-2' }), decrypt);

    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(edited.content).toBe('открытый: шифртекст-2');
  });

  it('из памяти — только текст: доставка и реакции берутся свежие', async () => {
    const decrypt = decryptor();
    await decryptPreviewOnce('c-1', message(), decrypt);

    const read = await decryptPreviewOnce(
      'c-1',
      message({ readAt: '2026-10-05T10:00:00Z' }),
      decrypt
    );

    expect(read).toMatchObject({
      content: 'открытый: шифртекст-1',
      readAt: '2026-10-05T10:00:00Z',
    });
  });

  it('нерасшифрованное не запоминается: ключ может прийти позже', async () => {
    const decrypt = vi
      .fn()
      .mockResolvedValueOnce({ ...message(), undecryptable: 'keyUnavailable' })
      .mockImplementationOnce(async (_chatId: string, preview: ILastMessageDto) => ({
        ...preview,
        content: 'открытый',
      }));

    await decryptPreviewOnce('c-1', message(), decrypt);
    const later = await decryptPreviewOnce('c-1', message(), decrypt);

    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(later.content).toBe('открытый');
  });

  it('сбой расшифровки (вернулся исходный шифртекст) не запоминается', async () => {
    const decrypt = vi.fn(async (_chatId: string, preview: ILastMessageDto) => preview);

    await decryptPreviewOnce('c-1', message(), decrypt);
    await decryptPreviewOnce('c-1', message(), decrypt);

    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it('после выхода из аккаунта открытого текста в памяти нет', async () => {
    const decrypt = decryptor();
    await decryptPreviewOnce('c-1', message(), decrypt);

    forgetDecryptedPreviews();
    await decryptPreviewOnce('c-1', message(), decrypt);

    expect(decrypt).toHaveBeenCalledTimes(2);
  });
});

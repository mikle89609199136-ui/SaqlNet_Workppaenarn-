import { afterEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import type { IChatDto } from '@/types';
import { chatsQuery } from './chatsQuery';
import { forgetDecryptedPreviews } from './previewDecryptionCache';

function makeChat(overrides: Partial<IChatDto>): IChatDto {
  return {
    id: 'chat-1',
    type: 'private',
    title: 'Чат',
    lastMessage: undefined,
    lastMessageAt: undefined,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  } as IChatDto;
}

const select = chatsQuery().select!;

describe('порядок списка чатов', () => {
  it('сверху те, где писали недавно', () => {
    const older = makeChat({
      id: 'older',
      lastMessage: { content: 'раньше' } as never,
      lastMessageAt: new Date('2026-09-01T10:00:00Z'),
    });
    const newer = makeChat({
      id: 'newer',
      lastMessage: { content: 'позже' } as never,
      lastMessageAt: new Date('2026-09-03T10:00:00Z'),
    });

    expect(select([older, newer]).map((chat) => chat.id)).toEqual(['newer', 'older']);
  });
});

describe('расшифровка превью при новом сообщении (#899)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    forgetDecryptedPreviews();
  });

  const listOf = (count: number, newest?: string) =>
    Array.from({ length: count }, (_, index) =>
      makeChat({
        id: `chat-${index}`,
        lastMessage: {
          id: index === 0 && newest ? newest : `m-${index}`,
          content: index === 0 && newest ? `шифр-${newest}` : `шифр-${index}`,
          type: 'text',
        } as never,
      })
    );

  it('новое сообщение в одном из 30 чатов — расшифровывается одно превью', async () => {
    const getChats = vi.spyOn(services.chatService, 'getChats');
    const decrypt = vi
      .spyOn(services.messageService, 'processLastMessageForDisplay')
      .mockImplementation(async (_chatId, preview) => ({ ...preview, content: 'открытый' }));
    const load = () => (chatsQuery().queryFn as () => Promise<IChatDto[]>)();

    getChats.mockResolvedValueOnce(listOf(30));
    await load();
    expect(decrypt).toHaveBeenCalledTimes(30);

    decrypt.mockClear();
    getChats.mockResolvedValueOnce(listOf(30, 'm-new'));
    const chats = await load();

    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt.mock.calls[0][1].id).toBe('m-new');
    expect(chats.every((chat) => chat.lastMessage?.content === 'открытый')).toBe(true);
  });
});

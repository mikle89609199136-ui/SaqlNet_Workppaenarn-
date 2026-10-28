import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_MESSAGES_PER_SEND } from '@/shared/config';
import { createApiClient } from '@/shared/api';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { secretText } from '@/test/msw/plaintextGuard';
import type { IMessageDto } from '@/types';
import type { CryptoService } from './CryptoService';
import { isCatalogMediaUrl, isOwnMediaUrl, MessageService } from './MessageService';
import { setChatResolver } from '@/entities/chat/model/chatResolver';
import {
  clearMediaObjectUrls,
  resolveMediaObjectUrl,
} from '@/entities/media/model/mediaObjectUrls';
import type { ILastMessageDto } from '@/entities/chat/model/types';
import type { IMessageEntity } from '@/shared/lib/richText';

const TARGET_CHAT = 'chat-target';

function message(id: string, chatId: string, content: string): IMessageDto {
  return {
    id,
    chatId,
    senderId: 'user-1',
    content,
    type: 'text',
    createdAt: '2026-08-24T10:00:00Z',
  } as IMessageDto;
}

// Заглушка шифрования: содержимое проходит насквозь. Настоящая
// криптография проверяется в src/crypto/*.node.test.ts.
const passthroughCrypto = {
  decryptMessage: async (_chatId: string, content: string) => ({ text: content }),
  encryptMessage: async (_chatId: string, content: string) => content,
  ensureChatKey: async () => ({ chatKey: null, membersWithoutIdentity: [] }),
} as unknown as CryptoService;

function createService() {
  return new MessageService(createApiClient(), passthroughCrypto);
}

describe('MessageService: загрузка истории', () => {
  it('should ask the server for the requested page', async () => {
    let requestedUrl = '';
    server.use(
      http.get(api(`/messages/${TARGET_CHAT}`), ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ messages: [] });
      })
    );

    await createService().fetchMessagesPage(TARGET_CHAT, 50, 50);

    const params = new URL(requestedUrl).searchParams;
    expect(params.get('offset')).toBe('50');
    expect(params.get('limit')).toBe('50');
  });

  it('should return messages in chronological order', async () => {
    server.use(
      http.get(api(`/messages/${TARGET_CHAT}`), () =>
        HttpResponse.json({
          messages: [
            { ...message('newer', TARGET_CHAT, 'позже'), createdAt: '2026-08-24T12:00:00Z' },
            { ...message('older', TARGET_CHAT, 'раньше'), createdAt: '2026-08-24T10:00:00Z' },
          ],
        })
      )
    );

    const messages = await createService().fetchMessagesPage(TARGET_CHAT);

    expect(messages.map((item) => item.id)).toEqual(['older', 'newer']);
  });

  it('should return an empty list when the server has nothing', async () => {
    server.use(http.get(api(`/messages/${TARGET_CHAT}`), () => HttpResponse.json({})));

    expect(await createService().fetchMessagesPage(TARGET_CHAT)).toEqual([]);
  });
});

/**
 * Сервер отправки (#808): принимает пачку и отвечает сообщениями в том же
 * порядке. Запоминает, что и сколькими запросами у него просили.
 */
function serveSend() {
  const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
  server.use(
    http.post(api(`/messages/${TARGET_CHAT}`), async ({ request }) => {
      const body = (await request.json()) as { messages: Array<Record<string, unknown>> };
      requests.push(body);
      return HttpResponse.json({
        messages: body.messages.map((item, index) =>
          message(`sent-${index}`, TARGET_CHAT, String(item.content ?? ''))
        ),
      });
    })
  );
  return requests;
}

describe('MessageService: отправка пачкой (#808)', () => {
  it('одно сообщение уходит пачкой из одного и возвращается расшифрованным', async () => {
    const requests = serveSend();

    const sent = await createService().sendMessage(TARGET_CHAT, '  обычное  ');

    expect(requests).toHaveLength(1);
    expect(requests[0].messages).toHaveLength(1);
    expect(requests[0].messages[0]).toMatchObject({ content: 'обычное', type: 'text' });
    expect(requests[0].messages[0]).not.toHaveProperty('forwardedFrom');
    expect(sent).toMatchObject({ id: 'sent-0', content: 'обычное' });
  });
});

describe('MessageService: пересылка', () => {
  it('should send the message into the target chat as a new one', async () => {
    // Серверная пересылка копировала шифртекст исходного чата, а ключи у
    // чатов разные — в целевом такое сообщение не расшифровалось бы
    // никогда. Поэтому текст шифруется заново, ключом целевого чата.
    const requests = serveSend();

    await createService().forwardMessages(TARGET_CHAT, [
      message('source', 'chat-source', 'переслано'),
    ]);

    expect(requests[0].messages[0]).toMatchObject({ content: 'переслано', type: 'text' });
  });

  it('should tell the server which message is forwarded', async () => {
    // Имя автора сервер подставит сам, проверив доступ: от клиента имя не
    // принимается, передаётся только идентификатор (#358).
    const requests = serveSend();

    await createService().forwardMessages(TARGET_CHAT, [
      message('source', 'chat-source', 'переслано'),
    ]);

    expect(requests[0].messages[0]).toMatchObject({ forwardedFrom: 'source' });
    expect(requests[0].messages[0]).not.toHaveProperty('forwardedSenderName');
  });

  it('комментарий и пересланные уходят одним запросом, комментарий первым', async () => {
    const requests = serveSend();

    const delivered = await createService().forwardMessages(
      TARGET_CHAT,
      [message('first', 'chat-source', 'первое'), message('second', 'chat-source', 'второе')],
      'смотри'
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].messages.map((item) => [item.content, item.forwardedFrom])).toEqual([
      ['смотри', undefined],
      ['первое', 'first'],
      ['второе', 'second'],
    ]);
    expect(delivered.map((item) => item.content)).toEqual(['смотри', 'первое', 'второе']);
  });

  it('больше предела за раз не отправляет', async () => {
    const requests = serveSend();
    const tooMany = Array.from({ length: MAX_MESSAGES_PER_SEND }, (_, index) =>
      message(`m-${index}`, 'chat-source', `сообщение ${index}`)
    );

    // С комментарием выходит на одно больше предела.
    await expect(
      createService().forwardMessages(TARGET_CHAT, tooMany, 'комментарий')
    ).rejects.toThrow(/Не больше/);
    expect(requests).toHaveLength(0);
  });

  it('отказывается пересылать то, что не смог прочитать', async () => {
    /* Пересылка идёт из ленты: если сообщение не расшифровалось, пересылать
       нечего — уйдёт сама заглушка, и получатель увидит замок как текст.

       Признак, а не текст: подпись заглушки переводится, и проверка по
       ведущему замку сломалась бы вместе с переводом. */
    const requests = serveSend();
    const unreadable = {
      ...message('source', 'chat-source', '🔒 Ключ шифрования недоступен'),
      undecryptable: 'keyUnavailable' as const,
    };

    await expect(
      createService().forwardMessages(TARGET_CHAT, [
        message('readable', 'chat-source', 'читается'),
        unreadable,
      ])
    ).rejects.toThrow(/не удалось расшифровать/);
    // Пачка — всё или ничего: не уходит и читаемое.
    expect(requests).toHaveLength(0);
  });
});

describe('MessageService: отметка о прочтении', () => {
  it('should confirm ids even when the chat was never loaded', async () => {
    server.use(
      http.post(api('/messages/read'), () =>
        HttpResponse.json({ readIds: ['m-1', 'm-2'], lastReadAt: '2026-09-29 12:00:00+00' })
      )
    );

    const result = await createService().markAsRead(TARGET_CHAT, ['m-1', 'm-2']);

    expect(result.readIds).toEqual(['m-1', 'm-2']);
  });

  it('прочитанными — только учтённые сервером ID, а не все отправленные (#506)', async () => {
    server.use(
      http.post(api('/messages/read'), () =>
        HttpResponse.json({ readIds: ['m-2'], lastReadAt: '2026-09-29 12:00:00+00' })
      )
    );

    const result = await createService().markAsRead(TARGET_CHAT, ['m-1', 'm-2']);

    expect(result.readIds).toEqual(['m-2']);
  });

  it('старый ответ без readIds — прочитанными отправленные', async () => {
    server.use(http.post(api('/messages/read'), () => HttpResponse.json({ success: true })));

    const result = await createService().markAsRead(TARGET_CHAT, ['m-1']);

    expect(result.readIds).toEqual(['m-1']);
  });

  it('should send the chat and the messages to the server', async () => {
    let body: unknown = null;
    server.use(
      http.post(api('/messages/read'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true });
      })
    );

    await createService().markAsRead(TARGET_CHAT, ['m-1']);

    expect(body).toEqual({ chatId: TARGET_CHAT, messageIds: ['m-1'] });
  });
});

describe('сторож открытого текста', () => {
  it('should catch a plaintext body reaching the network', async () => {
    // Проверка самого сторожа: если он перестанет ловить утечку, это будет
    // видно здесь, а не в тот день, когда утечка случится по-настоящему.
    const secret = secretText('пароль');

    server.use(http.post(api('/probe'), () => HttpResponse.json({ ok: true })));
    await createApiClient().post('/probe', { note: secret });

    const { assertNoPlaintextLeaked } = await import('@/test/msw/plaintextGuard');
    expect(() => assertNoPlaintextLeaked()).toThrow(/Открытый текст ушёл на сервер/);
  });
});

describe('MessageService: форматирование (#656)', () => {
  const bold: IMessageEntity[] = [{ type: 'bold', offset: 0, length: 6 }];

  afterEach(() => setChatResolver(null));

  function sealingCrypto() {
    const encryptMessage = vi.fn(
      async (_chatId: string, content: string, entities: IMessageEntity[] = []) =>
        `sealed(${content}|${JSON.stringify(entities)})`
    );
    const crypto = { ...passthroughCrypto, encryptMessage } as unknown as CryptoService;
    return { service: new MessageService(createApiClient(), crypto), encryptMessage };
  }

  it('в шифрованном чате форматирование уходит внутри конверта, открытого поля нет', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    const requests = serveSend();
    const { service, encryptMessage } = sealingCrypto();

    const sent = await service.sendMessage(TARGET_CHAT, 'привет', 'text', null, bold);

    expect(encryptMessage).toHaveBeenCalledWith(TARGET_CHAT, 'привет', bold, undefined);
    expect(requests[0].messages[0]).not.toHaveProperty('entities');
    expect(sent).toMatchObject({ content: 'привет', entities: bold });
  });

  it('в канале текст открытый — и форматирование тоже', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'channel' }) as never);
    const requests = serveSend();
    const { service, encryptMessage } = sealingCrypto();

    await service.sendMessage(TARGET_CHAT, 'привет', 'text', null, bold);

    expect(encryptMessage).not.toHaveBeenCalled();
    expect(requests[0].messages[0]).toMatchObject({ content: 'привет', entities: bold });
  });

  it('пробелы по краям срезаются вместе со сдвигом форматирования', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'channel' }) as never);
    const requests = serveSend();

    await createService().sendMessage(TARGET_CHAT, '  привет  ', 'text', null, [
      { type: 'bold', offset: 2, length: 6 },
    ]);

    expect(requests[0].messages[0]).toMatchObject({ content: 'привет', entities: bold });
  });

  it('пересылка сохраняет форматирование исходного сообщения', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    serveSend();
    const { service, encryptMessage } = sealingCrypto();

    await service.forwardMessages(TARGET_CHAT, [
      { ...message('source', 'chat-source', 'привет'), entities: bold },
    ]);

    expect(encryptMessage).toHaveBeenCalledWith(TARGET_CHAT, 'привет', bold, undefined);
  });
});

/* Вложения — только из сервиса медиа (#871): любой другой адрес не
   скачивается, даже если сообщение помечено зашифрованным. */
describe('MessageService: адрес вложения', () => {
  const media = (mediaUrl: string) =>
    ({
      ...message('m-media', TARGET_CHAT, ''),
      type: 'voice',
      metadata: { mediaUrl, mediaEncrypted: true },
    }) as IMessageDto;

  it.each([
    'https://attacker.example/api/v2/media/00000000-0000-4000-8000-000000000000',
    '/api/v2/users/me',
    '/api/v2/media/not-a-uuid',
    '//attacker.example/x',
  ])('не скачивает %s', async (mediaUrl) => {
    const requested = vi.fn();
    server.events.on('request:start', requested);
    try {
      const patch = await createService().resolveMediaForDisplay(TARGET_CHAT, media(mediaUrl));

      expect(patch).toMatchObject({ mediaUrl: null, mediaUnavailable: true });
      expect(requested).not.toHaveBeenCalled();
    } finally {
      server.events.removeListener('request:start', requested);
    }
  });

  it('скачивает загрузку сервиса медиа', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const requested = vi.fn();
    server.use(
      http.get(api(`/media/${id}`), () => {
        requested();
        return HttpResponse.json({});
      })
    );

    await createService().resolveMediaForDisplay(TARGET_CHAT, media(`/api/v2/media/${id}`));

    expect(requested).toHaveBeenCalled();
  });
});

/* Голосовое (#843): длительность и волна — только внутри шифровки. */
describe('MessageService: голосовое', () => {
  const voice = { durationMs: 7300, waveform: [1, 20, 31] };

  afterEach(() => setChatResolver(null));

  function voiceCrypto() {
    const encryptMessage = vi.fn(async () => 'sealed-envelope');
    const crypto = {
      ...passthroughCrypto,
      encryptMessage,
      encryptMedia: vi.fn(async () => ({
        version: 2,
        encrypted: true,
        algorithm: 'AES-GCM',
        iv: 'AAAAAAAAAAAAAAAA',
        ciphertext: 'AAAA',
        mimeType: 'audio/ogg; codecs=opus',
        sizeBytes: 3,
        keyEpoch: 1,
      })),
      decryptMedia: vi.fn(async () => new Blob(['ogg'])),
    } as unknown as CryptoService;
    return { service: new MessageService(createApiClient(), crypto), encryptMessage };
  }

  it('без подписи всё равно конверт, метаданных открытым полем нет', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    server.use(
      http.post(api('/media'), () =>
        HttpResponse.json({ url: '/api/v2/media/00000000-0000-4000-8000-000000000009' })
      )
    );
    const requests = serveSend();
    const { service, encryptMessage } = voiceCrypto();

    const sent = await service.sendMediaMessage(
      TARGET_CHAT,
      new Blob(['ogg'], { type: 'audio/ogg; codecs=opus' }),
      'voice',
      '',
      null,
      [],
      voice
    );

    expect(encryptMessage).toHaveBeenCalledWith(TARGET_CHAT, '', [], voice);
    const item = requests[0].messages[0];
    expect(item).toMatchObject({ type: 'voice', content: 'sealed-envelope', isEncrypted: true });
    expect(JSON.stringify(item)).not.toMatch(/7300|durationMs|waveform/);
    expect(item).not.toHaveProperty('fileName');
    // У себя пузырь сразу с метаданными.
    expect(sent).toMatchObject({ voice });
  });
});

/* Пересылка файла (#1060). Файл пересылаемого лежит в настоящем реестре
   расшифрованного медиа: прочитать его по адресу blob: через fetch на
   прод-сборке не даёт CSP, поэтому fetch здесь не подменяется. */
describe('MessageService: пересылка файла (#1060)', () => {
  const SOURCE_CHAT = 'chat-source';
  const sourcePath = (n: number) => `/api/v2/media/00000000-0000-4000-8000-0000000000a${n}`;
  const sealedFile = {
    version: 2,
    encrypted: true,
    algorithm: 'AES-GCM',
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'AAAA',
    mimeType: 'image/png',
    sizeBytes: 3,
    keyEpoch: 1,
  };

  afterEach(() => {
    setChatResolver(null);
    clearMediaObjectUrls();
  });

  /** Сервер загрузок: запоминает, сколько файлов к нему пришло. */
  function serveUpload() {
    const uploads: unknown[] = [];
    server.use(
      http.post(api('/media'), async ({ request }) => {
        uploads.push(await request.json());
        return HttpResponse.json({
          url: `/api/v2/media/00000000-0000-4000-8000-0000000001${uploads.length}0`,
        });
      })
    );
    return uploads;
  }

  function mediaCrypto(decrypted: Blob = new Blob(['png'])) {
    return {
      ...passthroughCrypto,
      encryptMessage: vi.fn(async () => 'sealed'),
      encryptMedia: vi.fn(async () => sealedFile),
      decryptMedia: vi.fn(async () => decrypted),
    };
  }

  /** Сообщение с файлом в том виде, в каком его держит лента. */
  function mediaMessage(
    id: string,
    type: IMessageDto['type'],
    path: string,
    objectUrl: string
  ): IMessageDto {
    return {
      ...message(id, SOURCE_CHAT, ''),
      type,
      mediaUrl: objectUrl,
      metadata: { mediaUrl: path, mediaEncrypted: true },
    } as unknown as IMessageDto;
  }

  /** Все обращения к fetch за время теста — чтобы убедиться, что blob: не читается. */
  function watchFetch() {
    const originalFetch = globalThis.fetch;
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => originalFetch(input, init));
  }

  function forwardedUrls(spy: ReturnType<typeof watchFetch>) {
    return spy.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input));
  }

  it('файл берётся из реестра, а не чтением blob: через fetch', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    const uploads = serveUpload();
    const requests = serveSend();
    const crypto = mediaCrypto();
    const photo = new Blob(['photo-bytes'], { type: 'image/png' });
    const objectUrl = await resolveMediaObjectUrl(sourcePath(1), async () => photo);
    const fetchSpy = watchFetch();

    try {
      await new MessageService(createApiClient(), crypto as never).forwardMessages(TARGET_CHAT, [
        mediaMessage('m-photo', 'image', sourcePath(1), objectUrl),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }

    expect(forwardedUrls(fetchSpy).filter((url) => url.startsWith('blob:'))).toEqual([]);
    expect(crypto.encryptMedia).toHaveBeenCalledWith(TARGET_CHAT, photo);
    expect(crypto.decryptMedia).not.toHaveBeenCalledWith(SOURCE_CHAT, expect.anything());
    expect(uploads).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0]).toMatchObject({ type: 'image', forwardedFrom: 'm-photo' });
  });

  it('файл, отпущенный реестром, скачивается заново и расшифровывается ключом исходного чата', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    const uploads = serveUpload();
    const requests = serveSend();
    const downloaded = vi.fn();
    server.use(
      http.get(api('/media/00000000-0000-4000-8000-0000000000a2'), () => {
        downloaded();
        return HttpResponse.json(sealedFile);
      })
    );
    const restored = new Blob(['photo-again'], { type: 'image/png' });
    const crypto = mediaCrypto(restored);
    // Адрес остался в снимке сообщения, а файл реестр уже отпустил.
    const staleUrl = await resolveMediaObjectUrl(sourcePath(2), async () => new Blob(['old']));
    clearMediaObjectUrls();

    await new MessageService(createApiClient(), crypto as never).forwardMessages(TARGET_CHAT, [
      mediaMessage('m-evicted', 'image', sourcePath(2), staleUrl),
    ]);

    expect(downloaded).toHaveBeenCalledTimes(1);
    expect(crypto.decryptMedia).toHaveBeenCalledWith(SOURCE_CHAT, sealedFile);
    expect(crypto.encryptMedia).toHaveBeenCalledWith(TARGET_CHAT, restored);
    expect(uploads).toHaveLength(1);
    expect(requests[0].messages[0]).toMatchObject({ forwardedFrom: 'm-evicted' });
  });

  it('файла нет ни в реестре, ни на сервере — в целевой чат ничего не уходит', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    const uploads = serveUpload();
    const requests = serveSend();
    server.use(
      http.get(api('/media/00000000-0000-4000-8000-0000000000a3'), () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 })
      )
    );
    const crypto = mediaCrypto();
    const staleUrl = await resolveMediaObjectUrl(sourcePath(3), async () => new Blob(['old']));
    clearMediaObjectUrls();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        new MessageService(createApiClient(), crypto as never).forwardMessages(TARGET_CHAT, [
          mediaMessage('m-gone', 'image', sourcePath(3), staleUrl),
        ])
      ).rejects.toThrow();
    } finally {
      warn.mockRestore();
    }

    expect(crypto.encryptMedia).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('несколько файлов уходят одной пачкой в прежнем порядке', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    const uploads = serveUpload();
    const requests = serveSend();
    const crypto = mediaCrypto();
    const photoUrl = await resolveMediaObjectUrl(sourcePath(4), async () => new Blob(['photo']));
    const fileUrl = await resolveMediaObjectUrl(sourcePath(5), async () => new Blob(['pdf']));

    await new MessageService(createApiClient(), crypto as never).forwardMessages(TARGET_CHAT, [
      mediaMessage('m-photo', 'image', sourcePath(4), photoUrl),
      mediaMessage('m-file', 'file', sourcePath(5), fileUrl),
    ]);

    expect(uploads).toHaveLength(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].messages).toEqual([
      expect.objectContaining({ type: 'image', forwardedFrom: 'm-photo' }),
      expect.objectContaining({ type: 'file', forwardedFrom: 'm-file' }),
    ]);
  });

  it('голосовое: длительность и волна уезжают в конверт целевого чата (#843)', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    serveUpload();
    serveSend();
    const crypto = mediaCrypto(new Blob(['ogg']));
    const voiceUrl = await resolveMediaObjectUrl(sourcePath(6), async () => new Blob(['ogg']));
    const voice = { durationMs: 9100, waveform: [4, 31] };

    await new MessageService(createApiClient(), crypto as never).forwardMessages(TARGET_CHAT, [
      { ...mediaMessage('m-voice', 'voice', sourcePath(6), voiceUrl), voice } as IMessageDto,
    ]);

    expect(crypto.encryptMessage).toHaveBeenCalledWith(TARGET_CHAT, '', [], voice);
  });
});

/* Стикер и GIF сервер принимает только ссылкой на каталог: шифрованную
   копию он отклоняет (#1061). А звонок и вложение без файла не уйдут
   вовсе — пачка с ними не должна ничего загружать. */
describe('MessageService: пересылка стикеров, GIF и непересылаемого (#1061)', () => {
  const stickerUrl = '/api/v2/media/11111111-1111-4111-8111-111111111111';
  const gifUrl = '/api/v2/media/22222222-2222-4222-8222-222222222222';

  afterEach(() => setChatResolver(null));

  /** Сервис со счётчиками загрузок и шифрования файлов. */
  function forwarding() {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    const uploads: unknown[] = [];
    server.use(
      http.post(api('/media'), async ({ request }) => {
        uploads.push(await request.json());
        return HttpResponse.json({ url: '/api/v2/media/00000000-0000-4000-8000-0000000002a0' });
      })
    );
    const requests = serveSend();
    const crypto = {
      ...passthroughCrypto,
      encryptMedia: vi.fn(async () => ({ encrypted: true })),
      decryptMedia: vi.fn(async () => new Blob(['x'])),
    };
    const service = new MessageService(createApiClient(), crypto as never);
    return { uploads, requests, crypto, service };
  }

  /** Стикер или GIF в том виде, в каком его держит лента. */
  const catalog = (id: string, type: 'sticker' | 'gif', url: string | null, extra = {}) =>
    ({
      ...message(id, 'chat-source', ''),
      type,
      mediaUrl: url,
      mediaOriginalUrl: url ?? undefined,
      mediaEncrypted: false,
      mediaUnavailable: !url,
      ...extra,
    }) as unknown as IMessageDto;

  it.each([
    ['стикер', 'sticker', stickerUrl],
    ['GIF', 'gif', gifUrl],
  ] as const)('%s пересылается ссылкой на каталог, без загрузки', async (_name, type, url) => {
    const { uploads, requests, crypto, service } = forwarding();

    await service.forwardMessages(TARGET_CHAT, [catalog('m-catalog', type, url)]);

    expect(uploads).toHaveLength(0);
    expect(crypto.encryptMedia).not.toHaveBeenCalled();
    expect(requests[0].messages[0]).toEqual({
      content: '',
      type,
      replyTo: null,
      mediaUrl: url,
      mediaType: type,
      mediaEncrypted: false,
      forwardedFrom: 'm-catalog',
    });
  });

  it('стикер не из каталога не пересылается и запросов нет', async () => {
    const { uploads, requests, service } = forwarding();

    await expect(
      service.forwardMessages(TARGET_CHAT, [
        catalog('m-foreign', 'sticker', null, { mediaUnavailableReason: 'foreign' }),
      ])
    ).rejects.toThrow();

    expect(uploads).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('звонок не пересылается', async () => {
    const { requests, service } = forwarding();
    const call = { ...message('m-call', 'chat-source', '{"status":"missed"}'), type: 'call' };

    await expect(service.forwardMessages(TARGET_CHAT, [call as IMessageDto])).rejects.toThrow();

    expect(requests).toHaveLength(0);
  });

  it.each(['', 'подпись'])('фото без файла не пересылается (подпись: «%s»)', async (caption) => {
    const { uploads, requests, service } = forwarding();
    const photo = {
      ...message('m-photo', 'chat-source', caption),
      type: 'image',
      mediaUrl: null,
      mediaUnavailable: true,
    } as unknown as IMessageDto;

    await expect(service.forwardMessages(TARGET_CHAT, [photo])).rejects.toThrow();

    expect(uploads).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('пачка [фото, звонок] не загружает и фото', async () => {
    const { uploads, requests, crypto, service } = forwarding();
    const photoUrl = await resolveMediaObjectUrl(
      '/api/v2/media/00000000-0000-4000-8000-0000000002a1',
      async () => new Blob(['photo'])
    );
    const photo = {
      ...message('m-photo', 'chat-source', ''),
      type: 'image',
      mediaUrl: photoUrl,
      metadata: { mediaUrl: '/api/v2/media/00000000-0000-4000-8000-0000000002a1' },
    } as unknown as IMessageDto;
    const call = { ...message('m-call', 'chat-source', '{}'), type: 'call' } as IMessageDto;

    try {
      await expect(service.forwardMessages(TARGET_CHAT, [photo, call])).rejects.toThrow();
    } finally {
      clearMediaObjectUrls();
    }

    expect(crypto.encryptMedia).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});

/* Сбой скачивания и сбой расшифровки — разные причины (#1062): первое
   лечится повтором, второе нет. Раньше оба показывались «ошибкой
   расшифровки». */
describe('MessageService: ошибки скачивания вложения (#1062)', () => {
  const id = '00000000-0000-4000-8000-0000000003a0';
  const photo = () =>
    ({
      ...message('m-photo', TARGET_CHAT, ''),
      type: 'image',
      metadata: { mediaUrl: `/api/v2/media/${id}`, mediaEncrypted: true },
    }) as unknown as IMessageDto;

  afterEach(() => {
    clearMediaObjectUrls();
    vi.restoreAllMocks();
  });

  function serviceWith(decryptMedia = vi.fn(async () => new Blob(['png']))) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return new MessageService(createApiClient(), { ...passthroughCrypto, decryptMedia } as never);
  }

  it.each([
    ['сеть', 'downloadFailed', () => HttpResponse.error()],
    ['500', 'downloadFailed', () => HttpResponse.json({}, { status: 500 })],
    ['502', 'downloadFailed', () => HttpResponse.json({}, { status: 502 })],
    ['429', 'downloadFailed', () => HttpResponse.json({}, { status: 429 })],
    ['404', 'notFound', () => HttpResponse.json({}, { status: 404 })],
    ['410', 'notFound', () => HttpResponse.json({}, { status: 410 })],
    ['403', 'forbidden', () => HttpResponse.json({}, { status: 403 })],
    [
      'битый JSON',
      'downloadFailed',
      () => new HttpResponse('{', { headers: { 'content-type': 'application/json' } }),
    ],
  ] as const)('скачивание: %s → %s', async (_name, reason, respond) => {
    server.use(http.get(api(`/media/${id}`), respond));

    const patch = await serviceWith().resolveMediaForDisplay(TARGET_CHAT, photo());

    expect(patch).toMatchObject({
      mediaUrl: null,
      mediaUnavailable: true,
      mediaUnavailableReason: reason,
    });
  });

  it('файл скачался, но не расшифровался → decryptFailed', async () => {
    server.use(http.get(api(`/media/${id}`), () => HttpResponse.json({ encrypted: true })));
    const decryptMedia = vi.fn(async () => {
      throw new Error('tag mismatch');
    });

    const patch = await serviceWith(decryptMedia).resolveMediaForDisplay(TARGET_CHAT, photo());

    expect(patch).toMatchObject({
      mediaUnavailable: true,
      mediaUnavailableReason: 'decryptFailed',
    });
  });

  it('после сбоя повторный вызов скачивает файл заново', async () => {
    let attempts = 0;
    server.use(
      http.get(api(`/media/${id}`), () => {
        attempts += 1;
        return attempts === 1 ? HttpResponse.error() : HttpResponse.json({ encrypted: true });
      })
    );
    const service = serviceWith();

    const failed = await service.resolveMediaForDisplay(TARGET_CHAT, photo());
    const retried = await service.resolveMediaForDisplay(TARGET_CHAT, photo());

    expect(failed).toMatchObject({ mediaUnavailableReason: 'downloadFailed' });
    expect(retried).toMatchObject({ mediaUnavailable: false });
    expect(String(retried.mediaUrl)).toMatch(/^blob:/);
    expect(attempts).toBe(2);
  });
});

/* Превью исходного сообщения в ответе (#1065): в шифрованном чате это
   конверт, и ни одним путём он не должен уйти в интерфейс шифрованным. */
describe('MessageService: превью ответа (#1065)', () => {
  afterEach(() => setChatResolver(null));

  /** «Шифрование»: `sealed:<текст>` открывается, `broken` — нет. */
  const sealedCrypto = {
    ...passthroughCrypto,
    encryptMessage: async (_chatId: string, content: string) => `sealed:${content}`,
    decryptMessage: vi.fn(async (_chatId: string, content: string) =>
      content === 'broken'
        ? { text: '', undecryptable: 'beforeJoin' }
        : {
            text: content.replace(/^sealed:/, ''),
            entities: [{ type: 'bold', offset: 0, length: 3 }],
          }
    ),
  };

  function serviceIn(type: 'private' | 'channel') {
    setChatResolver(async (chatId) => ({ id: chatId, type }) as never);
    sealedCrypto.decryptMessage.mockClear();
    return new MessageService(createApiClient(), sealedCrypto as never);
  }

  const preview = (content: string, type = 'text') => ({
    id: 'm-old',
    content,
    type,
    senderId: 'user-2',
    senderName: 'Анна',
    reactions: [],
  });

  const reply = (replyPreview?: ReturnType<typeof preview>) =>
    ({
      ...message('m-reply', TARGET_CHAT, 'sealed:ответ'),
      replyTo: 'm-old',
      ...(replyPreview ? { replyPreview } : {}),
    }) as unknown as IMessageDto;

  it('история: превью расшифровано тем же ключом чата, с форматированием', async () => {
    const shown = await serviceIn('private').processMessageForDisplay(
      TARGET_CHAT,
      reply(preview('sealed:давнее'))
    );

    expect(shown.content).toBe('ответ');
    expect(shown.replyPreview).toMatchObject({
      content: 'давнее',
      entities: [{ type: 'bold', offset: 0, length: 3 }],
    });
  });

  it('нерасшифрованное превью помечено, а сам ответ расшифрован', async () => {
    const shown = await serviceIn('private').processMessageForDisplay(
      TARGET_CHAT,
      reply(preview('broken'))
    );

    expect(shown.content).toBe('ответ');
    expect(shown.replyPreview).toMatchObject({ undecryptable: 'beforeJoin' });
  });

  it('превью звонка не расшифровывается и без служебного JSON', async () => {
    const shown = await serviceIn('private').processMessageForDisplay(
      TARGET_CHAT,
      reply(preview('{"callKind":"audio"}', 'call'))
    );

    expect(shown.replyPreview).toMatchObject({ type: 'call', content: '' });
    expect(sealedCrypto.decryptMessage).toHaveBeenCalledTimes(1);
  });

  it('без превью — лишних расшифровок нет', async () => {
    const shown = await serviceIn('private').processMessageForDisplay(TARGET_CHAT, reply());

    expect(shown).not.toHaveProperty('replyPreview');
    expect(sealedCrypto.decryptMessage).toHaveBeenCalledTimes(1);
  });

  it('ответ на отправку и на правку отдаёт открытое превью', async () => {
    const service = serviceIn('private');
    server.use(
      http.post(api(`/messages/${TARGET_CHAT}`), () =>
        HttpResponse.json({
          messages: [{ ...reply(preview('sealed:давнее')), content: 'sealed:новый' }],
        })
      ),
      http.put(api('/messages/m-reply'), () =>
        HttpResponse.json({ ...reply(preview('sealed:давнее')), content: 'sealed:правка' })
      )
    );

    const sent = await service.sendMessage(TARGET_CHAT, 'новый', 'text', 'm-old');
    const edited = await service.editMessage('m-reply', TARGET_CHAT, 'правка');

    expect(sent.replyPreview?.content).toBe('давнее');
    expect(edited.replyPreview?.content).toBe('давнее');
  });

  it('канал: превью открытое, отдаётся как есть', async () => {
    const shown = await serviceIn('channel').processMessageForDisplay(
      TARGET_CHAT,
      reply(preview('открытый текст'))
    );

    expect(shown.replyPreview?.content).toBe('открытый текст');
    expect(sealedCrypto.decryptMessage).not.toHaveBeenCalled();
  });
});

describe('MessageService: стикеры и GIF (#593, #871, #973, #1003)', () => {
  const validStickerUrl = '/api/v2/media/11111111-1111-4111-8111-111111111111';
  const validGifUrl = '/api/v2/media/22222222-2222-4222-8222-222222222222';

  it('isCatalogMediaUrl и isOwnMediaUrl пропускают только относительные пути /api/v2/media/{uuid}', () => {
    expect(isCatalogMediaUrl(validStickerUrl)).toBe(true);
    expect(isCatalogMediaUrl(validGifUrl)).toBe(true);
    expect(isOwnMediaUrl(validStickerUrl)).toBe(true);
    expect(isOwnMediaUrl(validGifUrl)).toBe(true);
    expect(isCatalogMediaUrl('/api/v2/stickers/packs/11111111-1111-4111-8111-111111111111')).toBe(
      false
    );
    expect(isOwnMediaUrl('/api/v2/stickers/packs/11111111-1111-4111-8111-111111111111')).toBe(
      false
    );
    expect(
      isCatalogMediaUrl(
        'http://minio:9000/crane-media/11111111-1111-4111-8111-111111111111/stickers/1712345678'
      )
    ).toBe(false);
    expect(
      isOwnMediaUrl(
        'http://minio:9000/crane-media/11111111-1111-4111-8111-111111111111/stickers/1712345678'
      )
    ).toBe(false);
    expect(isCatalogMediaUrl('https://example.com/dance.gif')).toBe(false);
    expect(isOwnMediaUrl('https://example.com/dance.gif')).toBe(false);
  });

  it('sendSticker отправляет сообщение типа sticker с mediaUrl', async () => {
    const requests = serveSend();
    const service = createService();

    const sent = await service.sendSticker(TARGET_CHAT, validStickerUrl);

    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0]).toMatchObject({
      type: 'sticker',
      mediaUrl: validStickerUrl,
      content: '',
    });
    expect(sent).toMatchObject({
      type: 'sticker',
      mediaUrl: validStickerUrl,
      mediaUnavailable: false,
    });
  });

  it('sendGif отправляет сообщение типа gif с mediaUrl', async () => {
    const requests = serveSend();
    const service = createService();

    const sent = await service.sendGif(TARGET_CHAT, validGifUrl);

    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0]).toMatchObject({
      type: 'gif',
      mediaUrl: validGifUrl,
      content: '',
    });
    expect(sent).toMatchObject({
      type: 'gif',
      mediaUrl: validGifUrl,
      mediaUnavailable: false,
    });
  });

  it('resolveMediaForDisplay не блокирует URL каталога для стикеров и GIF', async () => {
    const service = createService();
    const stickerMsg = {
      ...message('m-sticker', TARGET_CHAT, ''),
      type: 'sticker' as const,
      metadata: { mediaUrl: validStickerUrl } as never,
    };
    const gifMsg = {
      ...message('m-gif', TARGET_CHAT, ''),
      type: 'gif' as const,
      mediaUrl: validGifUrl,
    } as unknown as IMessageDto;

    const patchSticker = await service.resolveMediaForDisplay(TARGET_CHAT, stickerMsg);
    const patchGif = await service.resolveMediaForDisplay(TARGET_CHAT, gifMsg);

    expect(patchSticker).toEqual({
      mediaUrl: validStickerUrl,
      mediaOriginalUrl: validStickerUrl,
      mediaEncrypted: false,
      mediaUnavailable: false,
    });
    expect(patchGif).toEqual({
      mediaUrl: validGifUrl,
      mediaOriginalUrl: validGifUrl,
      mediaEncrypted: false,
      mediaUnavailable: false,
    });
  });

  it('resolveMediaForDisplay блокирует сторонние (не из каталога) URL для стикеров и GIF (#871, #1003)', async () => {
    const service = createService();
    const foreignStickerMsg = {
      ...message('m-sticker-foreign', TARGET_CHAT, ''),
      type: 'sticker' as const,
      metadata: { mediaUrl: 'https://evil.com/leak.png' } as never,
    };
    const traversalStickerMsg = {
      ...message('m-sticker-traversal', TARGET_CHAT, ''),
      type: 'sticker' as const,
      metadata: { mediaUrl: '/api/v2/stickers/../leak.png' } as never,
    };
    const minioStickerMsg = {
      ...message('m-sticker-minio', TARGET_CHAT, ''),
      type: 'sticker' as const,
      metadata: {
        mediaUrl:
          'http://minio:9000/crane-media/11111111-1111-4111-8111-111111111111/stickers/1712345678',
      } as never,
    };
    const evilBypassStickerMsg = {
      ...message('m-sticker-evil', TARGET_CHAT, ''),
      type: 'sticker' as const,
      metadata: {
        mediaUrl:
          'https://evil.com/crane-media/11111111-1111-4111-8111-111111111111/stickers/1712345678',
      } as never,
    };
    const foreignGifMsg = {
      ...message('m-gif-foreign', TARGET_CHAT, ''),
      type: 'gif' as const,
      mediaUrl: 'https://example.com/dance.gif',
    } as unknown as IMessageDto;

    const patchSticker = await service.resolveMediaForDisplay(TARGET_CHAT, foreignStickerMsg);
    const patchTraversal = await service.resolveMediaForDisplay(TARGET_CHAT, traversalStickerMsg);
    const patchMinioSticker = await service.resolveMediaForDisplay(TARGET_CHAT, minioStickerMsg);
    const patchEvilSticker = await service.resolveMediaForDisplay(
      TARGET_CHAT,
      evilBypassStickerMsg
    );
    const patchGif = await service.resolveMediaForDisplay(TARGET_CHAT, foreignGifMsg);

    expect(patchSticker).toEqual({
      mediaUrl: null,
      mediaEncrypted: false,
      mediaUnavailable: true,
      mediaUnavailableReason: 'foreign',
    });
    expect(patchTraversal).toEqual({
      mediaUrl: null,
      mediaEncrypted: false,
      mediaUnavailable: true,
      mediaUnavailableReason: 'foreign',
    });
    expect(patchMinioSticker).toEqual({
      mediaUrl: null,
      mediaEncrypted: false,
      mediaUnavailable: true,
      mediaUnavailableReason: 'foreign',
    });
    expect(patchEvilSticker).toEqual({
      mediaUrl: null,
      mediaEncrypted: false,
      mediaUnavailable: true,
      mediaUnavailableReason: 'foreign',
    });
    expect(patchGif).toEqual({
      mediaUrl: null,
      mediaEncrypted: false,
      mediaUnavailable: true,
      mediaUnavailableReason: 'foreign',
    });
  });
});

describe('MessageService: обработка последнего сообщения для превью (#971)', () => {
  it('сохраняет форматирование (entities) из расшифровки или открытого сообщения', async () => {
    const cryptoWithEntities = {
      decryptMessage: vi.fn(async (_chatId: string, content: string) => ({
        text: content,
        entities: [{ type: 'bold' as const, offset: 0, length: 6 }],
      })),
    } as unknown as CryptoService;

    const service = new MessageService(createApiClient(), cryptoWithEntities);
    const lastMsg: ILastMessageDto = {
      id: 'msg-1',
      content: 'Привет мир',
      type: 'text',
      senderId: 'user-1',
      senderName: 'User',
      reactions: [],
    };

    const processed = await service.processLastMessageForDisplay('chat-1', lastMsg, {
      type: 'private',
    });
    expect(processed.content).toBe('Привет мир');
    expect(processed.entities).toEqual([{ type: 'bold', offset: 0, length: 6 }]);
  });
});

describe('MessageService: listReactionAuthors (#998)', () => {
  it('вызывает эндпоинт с messageId, emoji, cursor и limit', async () => {
    const mockApiClient = {
      get: vi.fn().mockResolvedValue({
        data: {
          emoji: '👍',
          total: 2,
          users: [{ id: 'u-1', firstName: 'Алексей', lastName: 'Иванов', username: 'alex' }],
          nextCursor: 'cur-123',
        },
      }),
    } as unknown as ApiClient;

    const service = new MessageService(mockApiClient, {} as CryptoService);
    const result = await service.listReactionAuthors('msg-100', '👍', 'cur-prev', 20);

    expect(mockApiClient.get).toHaveBeenCalledWith('/messages/msg-100/reactions/users', {
      emoji: '👍',
      cursor: 'cur-prev',
      limit: 20,
    });
    expect(result?.total).toBe(2);
    expect(result?.users).toHaveLength(1);
    expect(result?.nextCursor).toBe('cur-123');
  });
});

describe('MessageService: желаемое состояние реакции', () => {
  it('отправляет одну замену или снятие через PUT', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put(api('/messages/message-1/reactions/me'), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ reactions: [] });
      })
    );
    const service = createService();
    await service.reactToMessage('message-1', '❤️');
    await service.reactToMessage('message-1', null);
    expect(bodies).toEqual([{ emoji: '❤️' }, { emoji: null }]);
  });
});

describe('персональные закрепления: HTTP контракт', () => {
  afterEach(() => setChatResolver(null));
  it('передаёт scope и не отправляет устаревший forEveryone', async () => {
    const requests: { method: string; scope: string | null; body: string }[] = [];
    const record = async ({ request }: { request: Request }) => {
      requests.push({
        method: request.method,
        scope: new URL(request.url).searchParams.get('scope'),
        body: await request.text(),
      });
      return HttpResponse.json({ success: true });
    };
    server.use(
      http.post(api('/chats/c-999/pins/m-999'), record),
      http.delete(api('/chats/c-999/pins/m-999'), record)
    );
    const service = createService();
    await service.pinMessage('c-999', 'm-999', 'personal');
    await service.pinMessage('c-999', 'm-999', 'chat');
    await service.unpinMessage('c-999', 'm-999', 'personal');
    expect(requests).toEqual([
      { method: 'POST', scope: 'personal', body: '' },
      { method: 'POST', scope: 'chat', body: '' },
      { method: 'DELETE', scope: 'personal', body: '' },
    ]);
  });
  it('дочитывает все страницы личных pins по серверному cursor', async () => {
    setChatResolver(async (chatId) => ({ id: chatId, type: 'private' }) as never);
    const cursors: (string | null)[] = [];
    server.use(
      http.get(api('/chats/c-999/pins'), ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get('scope')).toBe('personal');
        cursors.push(params.get('cursor'));
        const second = Boolean(params.get('cursor'));
        const id = second ? 'pin-second' : 'pin-first';
        return HttpResponse.json({
          pins: [
            {
              id,
              messageId: id,
              chatId: 'c-999',
              pinnedBy: 'me',
              pinnedAt: '2026-10-29T00:00:00Z',
              message: message(id, 'c-999', ''),
            },
          ],
          nextCursor: second ? undefined : 'cursor-2',
        });
      })
    );
    const pins = await createService().listPins('c-999', 'personal');
    expect(pins).toHaveLength(2);
    expect(cursors).toEqual([null, 'cursor-2']);
  });
});

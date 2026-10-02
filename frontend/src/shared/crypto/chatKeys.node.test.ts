import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '@/shared/api';
import { ChatKeyManager } from './chatKeys';
import { bytesToBase64 } from './encoding';
import { forgetPeerIdentities, loadOrCreateIdentity } from './identity';
import { listKeys, removeKeysWithPrefix, useMemoryKeyStore } from './keyStore';

/**
 * Поддельный сервер ключей.
 *
 * Повторяет поведение настоящего: запись атомарна и принимает только
 * текущую эпоху (доворачивание) или следующую (новый ключ); пока поднята
 * пометка «нужна смена ключа», текущую записать нельзя (#806). Список отдаёт
 * строки только нынешних участников вместе с эпохой и пометкой, своя копия
 * ключа доступна и после выхода из чата, у ротации есть предел в час.
 */

const CHAT = 'chat-1';

interface IServerRow {
  userId: string;
  encryptedKey: string;
  senderKeyId?: string;
  keyEpoch: number;
}

function createKeyServer() {
  const rows = new Map<string, IServerRow>();
  const members = new Set<string>();
  const identities = new Map<string, string>();

  const state = {
    rotateLimit: Number.POSITIVE_INFINITY,
    rotateCalls: 0,
    writes: 0,
    /** Пометка «нужна смена ключа»: её поднимает изменение состава. */
    rotationNeeded: false,
    /** Поднять пометку прямо перед следующей записью — гонка с изменением состава. */
    raiseFlagBeforeNextWrite: false,
  };

  const conflict = (code: string) => Object.assign(new Error(code), { status: 409, code });

  function currentEpoch() {
    return [...rows.values()].reduce((top, row) => Math.max(top, row.keyEpoch), 0);
  }

  function save(userId: string, incoming: IServerRow[], epoch: number, rotation: boolean) {
    if (state.raiseFlagBeforeNextWrite) {
      state.raiseFlagBeforeNextWrite = false;
      state.rotationNeeded = true;
    }

    const current = currentEpoch();
    const next = epoch === current + 1;
    if (!next) {
      if (epoch !== current || current === 0 || rotation) throw conflict('key_epoch_conflict');
      if (state.rotationNeeded) throw conflict('key_rotation_required');
    }

    for (const row of incoming) {
      // Не-участники молча пропускаются.
      if (!members.has(row.userId)) continue;

      const existing = rows.get(row.userId);
      // Понижение эпохи отбрасывается, равная — перезаписывает.
      if (existing && existing.keyEpoch > epoch) continue;

      rows.set(row.userId, { ...row, keyEpoch: epoch });
    }

    if (next) state.rotationNeeded = false;
    state.writes += 1;
    return { ok: true };
  }

  function apiFor(userId: string): ApiClient {
    const requireMember = () => {
      if (!members.has(userId)) throw Object.assign(new Error('access denied'), { status: 403 });
    };

    return {
      get: async (url: string) => {
        if (url.startsWith('/encryption/keys/')) {
          const target = url.replace('/encryption/keys/', '');
          const bundle = identities.get(target);
          if (!bundle) throw Object.assign(new Error('key not found'), { status: 404 });

          return { data: { publicKey: bundle, keyId: 'подставленное-значение' } };
        }

        if (url.startsWith('/encryption/chat-keys/')) {
          requireMember();
          return {
            data: {
              keys: [...rows.values()].filter((row) => members.has(row.userId)),
              keyEpoch: currentEpoch(),
              rotationNeeded: state.rotationNeeded,
            },
          };
        }

        if (url.startsWith('/encryption/my-key/')) {
          // Своя копия отдаётся без проверки членства — так на сервере.
          const row = rows.get(userId);
          if (!row) throw Object.assign(new Error('key not found'), { status: 404 });

          return { data: row };
        }

        throw new Error(`неожиданный GET ${url}`);
      },

      post: async (url: string, body: unknown) => {
        const payload = body as { encryptedKeys: IServerRow[]; keyEpoch: number };

        if (url.startsWith('/encryption/rotate-key/')) {
          requireMember();
          state.rotateCalls += 1;

          if (state.rotateCalls > state.rotateLimit) {
            throw Object.assign(new Error('rate limit'), { status: 429 });
          }

          return { data: save(userId, payload.encryptedKeys, payload.keyEpoch, true) };
        }

        if (url.startsWith('/encryption/chat-keys/')) {
          requireMember();
          return { data: save(userId, payload.encryptedKeys, payload.keyEpoch, false) };
        }

        if (url === '/encryption/keys' || url === '/auth/public-key') {
          return { data: { ok: true } };
        }

        throw new Error(`неожиданный POST ${url}`);
      },
    } as unknown as ApiClient;
  }

  return { rows, members, identities, state, apiFor };
}

type TKeyServer = ReturnType<typeof createKeyServer>;

async function createParticipant(server: TKeyServer, accountId: string) {
  const identity = await loadOrCreateIdentity(accountId);
  server.identities.set(accountId, identity.bundle);
  server.members.add(accountId);

  const manager = new ChatKeyManager({
    apiClient: server.apiFor(accountId),
    identity: async () => identity,
    members: async () => [...server.members],
  });

  return { identity, manager };
}

/** base64 из ASCII-строки: в окружении node нет btoa. */
function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** Ключ чата в виде строки — сравнивать байты неудобно. */
function keyText(key: Uint8Array | undefined): string {
  return key ? bytesToBase64(key) : '';
}

beforeEach(() => {
  useMemoryKeyStore();
  forgetPeerIdentities();
});

describe('раздача ключа чата', () => {
  it('should let every member open the key', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const boris = await createParticipant(server, 'boris');

    const created = await alice.manager.ensure(CHAT);
    const received = await boris.manager.ensure(CHAT);

    expect(keyText(received.chatKey?.key)).toBe(keyText(created.chatKey?.key));
    expect(received.chatKey?.epoch).toBe(1);
  });

  it('should not let an outsider open the key', async () => {
    // Блоб разворачивается общим секретом отправителя и получателя.
    // Посторонний не участвует ни в одном из них.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await createParticipant(server, 'boris');
    await alice.manager.ensure(CHAT);

    const outsiderIdentity = await loadOrCreateIdentity('mallory');
    server.identities.set('mallory', outsiderIdentity.bundle);
    const outsider = new ChatKeyManager({
      // Посторонний прикидывается участником, чтобы сервер отдал ему строки.
      apiClient: server.apiFor('alice'),
      identity: async () => outsiderIdentity,
      members: async () => [...server.members],
    });

    // Чужая строка не разворачивается: у постороннего другой приватный ключ.
    const stolen = server.rows.get('boris')!;
    const unwrapped = await outsider.acceptFromServer(CHAT);

    expect(stolen).toBeDefined();
    expect(unwrapped).toBeNull();
  });

  it('should write a row for every member', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await createParticipant(server, 'boris');
    await createParticipant(server, 'carol');

    await alice.manager.ensure(CHAT);

    expect([...server.rows.keys()].sort()).toEqual(['alice', 'boris', 'carol']);
  });

  it('should adopt the key that actually ended up on the server', async () => {
    // Двое могут создать ключ одновременно. Сервер примет одного, и второй
    // обязан принять его ключ, иначе чат распадётся на два набора ключей.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const boris = await createParticipant(server, 'boris');

    const first = await alice.manager.ensure(CHAT);
    // Борис создаёт свой ключ, не зная о ключе Алисы.
    boris.manager.forget();
    const second = await boris.manager.ensure(CHAT);

    expect(keyText(second.chatKey?.key)).toBe(keyText(first.chatKey?.key));
  });

  it('should not restart numbering when the server holds a newer epoch', async () => {
    // Своя строка может оказаться нечитаемой — например, завёрнутой для
    // ключа, которого на устройстве больше нет. Начать эпохи заново значит
    // получить запись, которую сервер молча отбросит, и шифровать ключом,
    // которого нет ни у кого.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    server.rows.set('alice', { userId: 'alice', encryptedKey: 'непонятно-что', keyEpoch: 19 });

    const created = await alice.manager.ensure(CHAT);

    expect(created.chatKey?.epoch).toBe(20);
    expect(server.rows.get('alice')?.keyEpoch).toBe(20);
  });

  it('should report members who cannot receive the key yet', async () => {
    // Человек ещё не входил с новой версией: связки ключей у него нет,
    // завернуть для него нечем. Это не повод останавливать переписку.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    server.members.add('никогда-не-входил');

    const result = await alice.manager.ensure(CHAT);

    expect(result.chatKey).not.toBeNull();
    expect(result.membersWithoutIdentity).toEqual(['никогда-не-входил']);
  });
});

describe('негодная строка на сервере', () => {
  it('should not choke on a blob it cannot read', async () => {
    // В строке может лежать что угодно: остаток прежней схемы, чужой
    // формат, просто мусор. Это не должно валить открытие чата.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    server.rows.set('alice', { userId: 'alice', encryptedKey: 'ne-base64-i-ne-json', keyEpoch: 3 });

    expect(await alice.manager.acceptFromServer(CHAT)).toBeNull();
  });

  it('should not accept a blob with fields missing', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    // Правильный base64 и правильный JSON, но без половины полей.
    const incomplete = toBase64(JSON.stringify({ v: 2, iv: 'AAAA' }));
    server.rows.set('alice', { userId: 'alice', encryptedKey: incomplete, keyEpoch: 3 });

    expect(await alice.manager.acceptFromServer(CHAT)).toBeNull();
  });
});

describe('сверка эпохи', () => {
  it('should pick up a newer epoch instead of trusting its own memory', async () => {
    // Участник может начать новую эпоху, пока мы держим свою в памяти:
    // например, он вошёл с нового устройства и не сумел развернуть свою
    // строку. Не сверяясь, мы продолжали бы шифровать ключом, которого
    // больше ни у кого нет. Проверено вживую: собеседники видели замок.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const boris = await createParticipant(server, 'boris');

    const first = await alice.manager.ensure(CHAT);
    const second = await boris.manager.rotate(CHAT);
    expect(second.chatKey?.epoch).toBe((first.chatKey?.epoch ?? 0) + 1);

    // Сверка не чаще раза в тридцать секунд, поэтому проверяем через
    // свежий экземпляр — так же, как это выглядит при открытии чата.
    alice.manager.forget();
    const after = await alice.manager.ensure(CHAT);

    expect(after.chatKey?.epoch).toBe(second.chatKey?.epoch);
    expect(keyText(after.chatKey?.key)).toBe(keyText(second.chatKey?.key));
  });
});

describe('собеседник сменил устройство', () => {
  it('should refetch the identity instead of trusting what it remembered', async () => {
    // Связка собеседника кешируется, и он мог войти с нового устройства
    // ровно после того, как мы её запомнили. Тогда завёрнутый им ключ не
    // разворачивается — а выглядит это как «ключа нет», и клиент начинает
    // новую эпоху вместо того, чтобы перечитать связку.
    //
    // Проверено вживую: собеседники видели замок вместо сообщений, пока
    // кеш не истечёт.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await createParticipant(server, 'boris');

    // Алиса запоминает нынешнюю связку Бориса.
    await alice.manager.ensure(CHAT);

    // Борис входит с нового устройства: тот же аккаунт, другая связка,
    // пустое хранилище ключей.
    const newBoris = {
      ...(await loadOrCreateIdentity('boris-vtoroye-ustroystvo')),
      accountId: 'boris',
    };
    server.identities.set('boris', newBoris.bundle);
    await removeKeysWithPrefix('chatkey:boris:');
    await removeKeysWithPrefix('chatkey-latest:boris:');
    const borisAgain = new ChatKeyManager({
      apiClient: server.apiFor('boris'),
      identity: async () => newBoris,
      members: async () => [...server.members],
    });
    const borisKey = await borisAgain.ensure(CHAT);

    // Алиса должна принять его ключ, хотя в памяти у неё прежняя связка.
    alice.manager.forget();
    const aliceKey = await alice.manager.ensure(CHAT);

    expect(aliceKey.chatKey?.epoch).toBe(borisKey.chatKey?.epoch);
    expect(keyText(aliceKey.chatKey?.key)).toBe(keyText(borisKey.chatKey?.key));
  });
});

describe('смена состава', () => {
  it('should raise the epoch and leave the removed member behind', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const boris = await createParticipant(server, 'boris');

    const before = await alice.manager.ensure(CHAT);
    await boris.manager.ensure(CHAT);

    server.members.delete('boris');
    const after = await alice.manager.rotate(CHAT);

    expect(after.chatKey?.epoch).toBe((before.chatKey?.epoch ?? 0) + 1);
    // Своя копия у Бориса осталась, но она от прежней эпохи: новые
    // сообщения ею не открыть.
    expect(server.rows.get('boris')?.keyEpoch).toBe(before.chatKey?.epoch);
  });

  it('should fall back to the plain route when rotation is rate limited', async () => {
    // Ротаций разрешено десять в час, у обычной записи предела нет.
    // Упереться в предел и остаться без ключей хуже, чем потерять запись
    // в журнале ротаций.
    const server = createKeyServer();
    server.state.rotateLimit = 0;
    const alice = await createParticipant(server, 'alice');
    await createParticipant(server, 'boris');
    await alice.manager.ensure(CHAT);

    const rotated = await alice.manager.rotate(CHAT);

    expect(rotated.chatKey?.epoch).toBe(2);
    expect(server.rows.get('boris')?.keyEpoch).toBe(2);
  });

  it('should not rotate twice in a row', async () => {
    // Событий о смене состава может прийти несколько подряд, а каждая
    // ротация — это запись для всех участников.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await alice.manager.ensure(CHAT);

    const first = await alice.manager.rotate(CHAT);
    const second = await alice.manager.rotate(CHAT);

    expect(second.chatKey?.epoch).toBe(first.chatKey?.epoch);
  });
});

describe('смена ключа не зависит от владельца (#806)', () => {
  it('should rotate when the first member opens the chat after someone left while everyone was offline', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const boris = await createParticipant(server, 'boris');
    await createParticipant(server, 'carol');
    await alice.manager.ensure(CHAT);

    // Карина вышла, в сети никого: сервер только поднял пометку.
    server.members.delete('carol');
    server.state.rotationNeeded = true;

    // Борис — не владелец — первым открывает чат.
    const opened = await boris.manager.ensure(CHAT);

    expect(opened.chatKey?.epoch).toBe(2);
    expect(server.state.rotationNeeded).toBe(false);
    expect(server.rows.get('carol')?.keyEpoch).toBe(1);
    alice.manager.forget();
    expect(keyText((await alice.manager.ensure(CHAT)).chatKey?.key)).toBe(
      keyText(opened.chatKey?.key)
    );
  });

  it('should not hand the current key to a newcomer while rotation is pending', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const first = await alice.manager.ensure(CHAT);

    // Даниила добавили, пока владельца не было в сети.
    const daniil = await createParticipant(server, 'daniil');
    server.state.rotationNeeded = true;

    // Алиса открыла чат и доворачивает ключ: вместо прежнего — новая эпоха.
    await alice.manager.heal(CHAT);

    expect(server.rows.get('daniil')?.keyEpoch).toBe(2);
    const received = await daniil.manager.acceptFromServer(CHAT);
    expect(received?.epoch).toBe(2);
    expect(keyText(received?.key)).not.toBe(keyText(first.chatKey?.key));
    expect(await daniil.manager.forEpoch(CHAT, 1)).toBeNull();
  });

  it('should end with one key when two members rotate at once', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const boris = await createParticipant(server, 'boris');
    await alice.manager.ensure(CHAT);
    await boris.manager.ensure(CHAT);
    server.state.rotationNeeded = true;

    const [byAlice, byBoris] = await Promise.all([
      alice.manager.rotateIfNeeded(CHAT),
      boris.manager.rotateIfNeeded(CHAT),
    ]);

    expect(byAlice.chatKey?.epoch).toBe(2);
    expect(byBoris.chatKey?.epoch).toBe(2);
    expect(keyText(byAlice.chatKey?.key)).toBe(keyText(byBoris.chatKey?.key));
  });

  it('should not rotate when nobody changed the membership', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await alice.manager.ensure(CHAT);
    const writesBefore = server.state.writes;

    const result = await alice.manager.rotateIfNeeded(CHAT);

    expect(result.chatKey?.epoch).toBe(1);
    expect(server.state.writes).toBe(writesBefore);
  });

  it('should rotate when membership changes between reading and healing', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await alice.manager.ensure(CHAT);
    const erik = await createParticipant(server, 'erik');

    // Пометка поднялась между чтением и записью: сервер не даст раздать
    // прежний ключ.
    server.state.raiseFlagBeforeNextWrite = true;
    await alice.manager.heal(CHAT);

    expect(server.state.rotationNeeded).toBe(false);
    expect((await erik.manager.acceptFromServer(CHAT))?.epoch).toBe(2);
  });
});

describe('доворачивание ключа', () => {
  it('should wrap the key for a member who has no row', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await alice.manager.ensure(CHAT);

    const carol = await createParticipant(server, 'carol');
    await alice.manager.heal(CHAT);

    const received = await carol.manager.acceptFromServer(CHAT);

    expect(received).not.toBeNull();
  });

  it('should wrap the key again for a member whose row lagged behind', async () => {
    // Строка вернувшегося участника воскресает со старой эпохой — это
    // проверено на живом сервере.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const boris = await createParticipant(server, 'boris');
    await alice.manager.ensure(CHAT);
    await alice.manager.rotate(CHAT);

    server.rows.set('boris', { ...server.rows.get('boris')!, keyEpoch: 1 });
    await alice.manager.heal(CHAT);

    expect(server.rows.get('boris')?.keyEpoch).toBe(2);
    boris.manager.forget();
    expect((await boris.manager.acceptFromServer(CHAT))?.epoch).toBe(2);
  });

  it('should wrap the key again for a member who changed devices', async () => {
    // Новое устройство — новая связка ключей. Прежняя строка завёрнута для
    // ключа, которого у человека больше нет.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await createParticipant(server, 'boris');
    await alice.manager.ensure(CHAT);

    const rowBefore = server.rows.get('boris')!.encryptedKey;
    const newDevice = await loadOrCreateIdentity('boris-new-device');
    server.identities.set('boris', newDevice.bundle);
    forgetPeerIdentities();

    await alice.manager.heal(CHAT);

    expect(server.rows.get('boris')!.encryptedKey).not.toBe(rowBefore);
  });

  it('should do nothing when every member already has the current key', async () => {
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await createParticipant(server, 'boris');
    await alice.manager.ensure(CHAT);

    const writesBefore = server.state.writes;
    // Первое лечение сразу после создания: чинить нечего.
    await alice.manager.heal(CHAT);

    expect(server.state.writes).toBe(writesBefore);
  });
});

describe('незнакомая эпоха', () => {
  it('should fetch the key when a message arrives from a newer epoch', async () => {
    // Сообщение написано после ротации, о которой это устройство ещё не
    // слышало.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const boris = await createParticipant(server, 'boris');
    await alice.manager.ensure(CHAT);
    await boris.manager.ensure(CHAT);

    const rotated = await alice.manager.rotate(CHAT);
    boris.manager.forget();

    const found = await boris.manager.forEpoch(CHAT, rotated.chatKey!.epoch);

    expect(keyText(found?.key)).toBe(keyText(rotated.chatKey?.key));
  });

  it('should keep the previous epoch for older messages', async () => {
    // Ротация не должна закрывать собственную историю.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    const first = await alice.manager.ensure(CHAT);
    await alice.manager.rotate(CHAT);

    const old = await alice.manager.forEpoch(CHAT, 1);

    expect(keyText(old?.key)).toBe(keyText(first.chatKey?.key));
  });
});

describe('стирание с устройства', () => {
  it('should leave no chat keys in storage', async () => {
    // «Завершить все сеансы» нажимают на чужом или потерянном компьютере:
    // после этого на устройстве не должно остаться ничего, чем можно
    // прочитать переписку.
    const server = createKeyServer();
    const alice = await createParticipant(server, 'alice');
    await alice.manager.ensure(CHAT);

    expect(await listKeys('chatkey:alice:')).not.toHaveLength(0);

    await alice.manager.wipe('alice');

    expect(await listKeys('chatkey:alice:')).toHaveLength(0);
    expect(await listKeys('chatkey-latest:alice:')).toHaveLength(0);
  });
});

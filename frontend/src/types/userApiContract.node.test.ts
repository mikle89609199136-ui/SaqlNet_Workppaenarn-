import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Ajv from '@redocly/ajv';
import { describe, expect, it } from 'vitest';
import type { components } from './api.generated';

// Тестируем выбранный wire-контракт, а не наличие runtime-валидации в Go (#495).
const { load } = createRequire(import.meta.url)('js-yaml') as {
  load: (source: string) => unknown;
};
type Schema = {
  $ref?: string;
  type?: string;
  properties?: Record<string, Schema>;
  enum?: unknown[];
  allOf?: Schema[];
};
type Response = { $ref?: string; content?: Record<string, { schema: Schema }> };
type Operation = {
  operationId: string;
  security?: unknown[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, Response>;
  'x-error-codes': Record<string, string[]>;
};
const readContract = <T>(path: string): T =>
  load(
    readFileSync(new URL(`../../../backend-v2/contracts/openapi/${path}`, import.meta.url), 'utf8')
  ) as T;
const schemas = readContract<Record<string, Schema>>('components/schemas.yaml');
const responses = readContract<Record<string, Response>>('components/responses.yaml');
const paths = readContract<Record<string, Record<string, Operation>>>('paths/users.yaml');
const api = readContract<{ paths: Record<string, { $ref: string }> }>('api-v2.yaml');
const operations = Object.values(paths).flatMap((item) =>
  Object.values(item).filter((value) => value.operationId)
);
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addKeyword({
  keyword: 'x-min-trimmed-utf8-bytes',
  type: 'string',
  schemaType: 'number',
  validate: (minimum: number, value: string) =>
    Buffer.byteLength(value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, ''), 'utf8') >=
    minimum,
});
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat(
  'date-time',
  (value: string) =>
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value))
);
ajv.addFormat('uri', (value: string) => {
  try {
    return Boolean(new URL(value).protocol);
  } catch {
    return false;
  }
});
ajv.addSchema({ $id: 'urn:crane:user-contract', ...schemas });
const validator = (name: string) => ajv.compile({ $ref: `urn:crane:user-contract#/${name}` });
const accepts = (name: string, value: unknown) => validator(name)(value);
const schemaName = (ref: string) => ref.split('#/')[1];

// satisfies проверяет также форму сгенерированных TS-типов, включая partial/null.
const settingsPatch = {
  theme: 'system',
  palette: 'warm',
  accentPreset: 'teal',
  notifications: false,
  showMessageAvatars: false,
} satisfies components['schemas']['MvpSettings'];
const bulkPatch = {
  settings: { sounds: false },
  privacySettings: { calls: 'contacts' },
  notificationSettings: null,
  soundSettings: {},
  folders: [],
} satisfies components['schemas']['LegacySettingsBulkPatch'];
const profile = {
  id: 'e581b9b9-c437-40ca-8502-75346778f676',
  username: 'alice',
  firstName: 'Алиса',
  lastName: '',
  bio: '',
  avatarUrl: '',
  badges: null,
  isPremium: false,
  isBot: false,
} satisfies components['schemas']['UserProfile'];

describe('Исполнимый контракт User API (#453)', () => {
  it('единый источник defaults #451 соответствует схемам разделов', () => {
    const defaults = JSON.parse(
      readFileSync(
        new URL(
          '../../../backend-v2/internal/platform/settingsdefaults/defaults.json',
          import.meta.url
        ),
        'utf8'
      )
    ) as Record<string, unknown>;
    for (const [key, schema] of Object.entries({
      settings: 'MvpSettings',
      privacy_settings: 'PrivacySettings',
      notification_settings: 'LegacyNotificationSettings',
      sound_settings: 'LegacySoundSettings',
      storage_settings: 'LegacyStorageSettings',
      advanced_settings: 'LegacyAdvancedSettings',
      folders: 'LegacyFolders',
    })) {
      expect(accepts(schema, defaults[key]), key).toBe(true);
    }
  });

  it('покрывает все 46 операций, опубликованных корневым контрактом', () => {
    expect(operations).toHaveLength(46);
    expect(new Set(operations.map((op) => op.operationId)).size).toBe(operations.length);
    for (const path of Object.keys(paths)) {
      expect(api.paths[path].$ref).toContain('./paths/users.yaml#/');
    }
  });

  it('каждый JSON request/success имеет компилируемую именованную схему', () => {
    for (const op of operations) {
      const jsonSchemas = [
        ...Object.values(op.requestBody?.content ?? {}).map((entry) => entry.schema),
        ...Object.entries(op.responses)
          .filter(([status]) => status.startsWith('2'))
          .flatMap(([status, response]) => {
            if (status === '204') {
              expect(response.content).toBeUndefined();
              return [];
            }
            expect(response.content?.['application/json'], op.operationId).toBeDefined();
            return Object.values(response.content ?? {}).map((entry) => entry.schema);
          }),
      ];
      for (const schema of jsonSchemas) {
        expect(schema.$ref, op.operationId).toBeDefined();
        const name = schemaName(schema.$ref!);
        expect(name).not.toBe('Object');
        expect(() => validator(name), `${op.operationId}: ${name}`).not.toThrow();
      }
    }
  });

  it('матрица ошибок согласована с reusable responses и их enum кодов', () => {
    for (const op of operations) {
      for (const status of ['429', '500', '502']) expect(op.responses[status]).toBeDefined();
      if (op.security) {
        for (const status of ['401', '503']) expect(op.responses[status]).toBeDefined();
      }
      for (const [status, response] of Object.entries(op.responses)) {
        if (status.startsWith('2')) continue;
        const reusable = responses[schemaName(response.$ref!)];
        const name = schemaName(reusable.content!['application/json'].schema.$ref!);
        const codes = schemas[name].allOf![1].properties!.code.enum!;
        expect(op['x-error-codes'][status], `${op.operationId}: ${status}`).toBeDefined();
        expect([...codes].sort()).toEqual([...op['x-error-codes'][status]].sort());
        for (const code of op['x-error-codes'][status]) {
          expect(codes).toContain(code);
          expect(accepts(name, { code, message: 'Ошибка' })).toBe(true);
        }
        expect(accepts(name, { code: 'undocumented_code', message: 'Ошибка' })).toBe(false);
        expect(accepts(name, { code: codes[0] })).toBe(false);
      }
    }
  });

  it('принимает partial settings и false, не требуя defaults в PUT', () => {
    for (const value of [{}, settingsPatch, { callSounds: false }, { language: 'en' }]) {
      expect(accepts('MvpSettings', value)).toBe(true);
    }
  });

  it.each([
    null,
    [],
    { theme: 'sepia' },
    { palette: 'blue' },
    { accentPreset: '#ff0000' },
    { language: 'xx' },
    { textSize: 16 },
    { chatDensity: 'tiny' },
    { sounds: 0 },
    { callSounds: null },
    { showMessageAvatars: 'false' },
    { callsFrom: 'all' },
    { autoplayGifs: true },
    { settings: { theme: 'light' } },
  ])('отклоняет некорректный canonical patch: %j', (value) => {
    expect(accepts('MvpSettings', value)).toBe(false);
  });

  it('различает bulk no-op и dedicated folders replacement', () => {
    expect(accepts('LegacySettingsBulkPatch', bulkPatch)).toBe(true);
    expect(accepts('LegacySettingsBulkPatch', { settings: null, folders: null })).toBe(true);
    expect(
      accepts('LegacySettingsBulkPatch', { folders: [null, { name: 'Старые', ids: [] }] })
    ).toBe(true);
    for (const value of [
      null,
      { settings: { theme: null } },
      { soundSettings: { mediaVolume: 101 } },
      { unknown: {} },
    ]) {
      expect(accepts('LegacySettingsBulkPatch', value)).toBe(false);
    }
    expect(accepts('LegacyFoldersRequest', { folders: [] })).toBe(true);
    expect(accepts('LegacyFoldersRequest', {})).toBe(false);
    expect(accepts('LegacyFoldersRequest', { folders: null })).toBe(false);
  });

  it('ограничивает типы, диапазоны и ключи compatibility-разделов', () => {
    expect(accepts('LegacySoundSettings', { notificationsVolume: 0, mediaVolume: 100 })).toBe(true);
    expect(accepts('LegacySoundSettings', { notificationsVolume: -1 })).toBe(false);
    expect(accepts('LegacySoundSettings', { mediaVolume: 1.5 })).toBe(false);
    expect(accepts('LegacyNotificationSettings', { readReceipts: false })).toBe(true);
    expect(accepts('LegacyNotificationSettings', { calls: 'all' })).toBe(false);
    expect(accepts('LegacyStorageSettings', { autoDownloadWifi: null })).toBe(false);
    expect(accepts('LegacyAdvancedSettings', { arbitraryFlag: true })).toBe(false);
    expect(accepts('LegacyGeneralSettings', { accentColor: '#ff00aa', fontSize: 'small' })).toBe(
      true
    );
    expect(accepts('MvpSettings', { fontSize: 'small' })).toBe(false);
  });

  it('принимает legacy privacy aliases только на входе', () => {
    expect(accepts('PrivacySettingsPatch', { calls: 'contacts', lastSeen: 'everyone' })).toBe(true);
    expect(accepts('PrivacySettings', { calls: 'contacts' })).toBe(false);
    expect(accepts('PrivacySettingsPatch', { calls: null })).toBe(false);
    expect(accepts('PrivacySettingsPatch', { callsFrom: 'all' })).toBe(false);
  });

  it('сохраняет реальную nullable-семантику списков и обязательные поля профиля', () => {
    expect(accepts('ProfileResponse', { user: profile })).toBe(true);
    expect(accepts('ProfileResponse', { user: { id: profile.id } })).toBe(false);
    for (const name of ['UserSearchResponse', 'UserBlockedResponse']) {
      const key = name === 'UserSearchResponse' ? 'users' : 'blocked';
      expect(accepts(name, { [key]: null })).toBe(true);
      expect(accepts(name, { [key]: [] })).toBe(true);
      expect(accepts(name, {})).toBe(false);
    }
    expect(accepts('DevicesResponse', { devices: null })).toBe(false);
    expect(accepts('DevicesResponse', { devices: [] })).toBe(true);
    expect(accepts('PrivacyExceptionsResponse', { exceptions: null })).toBe(false);
  });

  it('различает PostgreSQL timestamps и RFC 3339 exportedAt', () => {
    const exported = {
      user: profile,
      chats: [{ id: profile.id, title: 'Чат', type: 'group', createdAt: '2026-10-16 18:00:00+00' }],
      settings: {},
      privacy: {},
      exportedAt: '2026-10-16T18:00:00Z',
    } satisfies components['schemas']['UserExport'];
    expect(accepts('UserExport', exported)).toBe(true);
    expect(accepts('UserExport', { ...exported, exportedAt: '2026-10-16 18:00:00+00' })).toBe(
      false
    );
    expect(accepts('UserExport', { ...exported, chats: null })).toBe(true);
  });

  it('фиксирует timeout=0 и обязательность endpoint/keys без изменения Go', () => {
    expect(accepts('PasscodeTimeoutRequest', { timeout: 0 })).toBe(true);
    for (const value of [{}, { timeout: -1 }, { timeout: 1.5 }]) {
      expect(accepts('PasscodeTimeoutRequest', value)).toBe(false);
    }
    expect(accepts('PushSubscriptionRequest', { endpoint: 'https://fcm.googleapis.com/a' })).toBe(
      false
    );
    expect(accepts('DeletePushSubscriptionRequest', { endpoint: '' })).toBe(false);
  });

  it('проверяет реальный byte-limit passcode, включая trim и кириллицу', () => {
    expect(accepts('SetPasscodeRequest', { passcode: '1234' })).toBe(true);
    expect(accepts('SetPasscodeRequest', { passcode: 'яя' })).toBe(true);
    expect(accepts('SetPasscodeRequest', { passcode: ' 123 ' })).toBe(false);
    expect(accepts('SetPasscodeRequest', { passcode: '    ' })).toBe(false);
  });
});

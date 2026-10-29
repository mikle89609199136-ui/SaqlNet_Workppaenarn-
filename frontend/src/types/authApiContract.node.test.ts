import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Ajv from '@redocly/ajv';
import { describe, expect, it } from 'vitest';
import type { components } from './api.generated';

const { load } = createRequire(import.meta.url)('js-yaml') as {
  load: (source: string) => unknown;
};
type Schema = Record<string, unknown>;
type Operation = {
  operationId: string;
  security: unknown[];
  'x-body-limit-bytes'?: number;
  'x-error-codes': Record<string, string[]>;
  requestBody?: unknown;
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
};
const read = <T>(path: string): T =>
  load(
    readFileSync(new URL(`../../../backend-v2/contracts/openapi/${path}`, import.meta.url), 'utf8')
  ) as T;
const schemas = read<Record<string, Schema>>('components/schemas.yaml');
const paths = read<Record<string, Record<string, Operation>>>('paths/auth.yaml');
const operations = Object.values(paths).flatMap((item) => Object.values(item));
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema({ $id: 'urn:crane:auth', ...schemas });
const accepts = (name: string, data: unknown) =>
  ajv.compile({ $ref: `urn:crane:auth#/${name}` })(data);
const normalizeRefs = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeRefs);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === '$ref' && typeof item === 'string'
          ? item.replace('../components/schemas.yaml#/', 'urn:crane:auth#/')
          : normalizeRefs(item),
      ])
    );
  return value;
};
const user = {
  id: '42800000-0000-4000-8000-000000000001',
  username: 'alice',
  firstName: 'Алиса',
  lastName: '',
  bio: '',
  avatarUrl: '',
} satisfies components['schemas']['AuthUser'];
const payload = { senderPublicKey: 'sender', iv: 'iv', ct: 'ciphertext' };

describe('Исполнимый контракт Auth API (#428)', () => {
  it('покрывает все реальные маршруты Auth и 23 операции', () => {
    const source = readFileSync(
      new URL('../../../backend-v2/cmd/auth/main.go', import.meta.url),
      'utf8'
    );
    const registered = [
      ...source.matchAll(/mux.Handle(?:Func)?\("\/api\/v2(\/auth\/[^" ]+)"/g),
    ].map((m) => m[1]);
    expect(Object.keys(paths).sort()).toEqual([...new Set(registered)].sort());
    expect(operations).toHaveLength(23);
    expect(new Set(operations.map((op) => op.operationId)).size).toBe(23);
  });

  for (const op of operations) {
    it(`${op.operationId}: схемы успеха, ошибок, cookie security и лимиты`, () => {
      for (const [status, response] of Object.entries(op.responses)) {
        if (status === '204') {
          expect(response.content).toBeUndefined();
        } else {
          expect(response.content?.['application/json'].schema).toBeDefined();
        }
        if (Number(status) >= 400) {
          const codes = op['x-error-codes'][status];
          expect(codes.length).toBeGreaterThan(0);
          const validate = ajv.compile(
            normalizeRefs(response.content!['application/json'].schema) as Schema
          );
          for (const code of codes) expect(validate({ code, message: 'safe message' })).toBe(true);
          expect(validate({ code: 'undocumented_code', message: 'safe message' })).toBe(false);
        }
      }
      if (op.security.length) {
        expect(op.security).toEqual([{ sessionCookie: [] }]);
        expect(op['x-error-codes']['401']).toContain('token_revoked');
        expect(op['x-error-codes']['503']).toContain('crypto_unavailable');
      }
      if (op.requestBody) {
        expect([16384, 65536]).toContain(op['x-body-limit-bytes']);
        expect(op['x-error-codes']['400']).toContain('invalid_json');
      }
      expect(op['x-error-codes']['429']).toEqual(['rate_limited']);
      expect(op['x-error-codes']['502']).toEqual(['upstream_unavailable']);
    });
  }

  it('неверные подтверждающие credentials — 403, ошибка сессии — 401', () => {
    for (const id of ['changePassword', 'disableTwoFactor', 'verifyTwoFactor']) {
      const op = operations.find((item) => item.operationId === id)!;
      expect(op['x-error-codes']['403']).toContain('wrong_password');
      expect(op['x-error-codes']['401']).not.toContain('wrong_password');
      expect(op['x-error-codes']['401']).toContain('token_revoked');
    }
  });

  it('возвращает user без токена, статус 2FA и результат проверки', () => {
    expect(accepts('AuthResponse', { user })).toBe(true);
    expect(accepts('AuthResponse', { user, authToken: 'secret' })).toBe(false);
    expect(accepts('AuthResponse', { user: { id: user.id } })).toBe(false);
    expect(accepts('TwoFactorStatusResponse', { enabled: false })).toBe(true);
    expect(accepts('TwoFactorVerifyResponse', { success: true, required: false })).toBe(true);
    expect(accepts('TwoFactorVerifyResponse', { success: false, required: true })).toBe(false);
  });

  it('условные QR states требуют свои payload/timestamps и не возвращают токен', () => {
    for (const name of ['QrStatusResponse', 'QrOfferStatusResponse']) {
      expect(accepts(name, { status: 'pending', expiresAt: 1800000000000 })).toBe(true);
      expect(accepts(name, { status: 'pending' })).toBe(false);
      expect(accepts(name, { status: 'confirmed', payload })).toBe(true);
      expect(accepts(name, { status: 'confirmed' })).toBe(false);
      expect(accepts(name, { status: 'expired' })).toBe(true);
      expect(accepts(name, { status: 'expired', payload })).toBe(false);
      expect(accepts(name, { status: 'confirmed', payload, authToken: 'secret' })).toBe(false);
    }
    expect(accepts('QrStatusResponse', { status: 'scanned', expiresAt: 1800000000000 })).toBe(true);
    expect(accepts('QrOfferStatusResponse', { status: 'scanned', expiresAt: 1800000000000 })).toBe(
      false
    );
    expect(accepts('QrOfferState', { status: 'claimed', expiresAt: 1800000000000 })).toBe(false);
  });

  it('границы имён и непустое имя регистрации совпадают с #416', () => {
    const request = { username: 'valid_user', password: 'Password1!', firstName: '😀'.repeat(64) };
    expect(accepts('RegisterRequest', request)).toBe(true);
    expect(accepts('RegisterRequest', { ...request, firstName: '😀'.repeat(65) })).toBe(false);
    expect(accepts('RegisterRequest', { ...request, firstName: '  ' })).toBe(false);
  });
});

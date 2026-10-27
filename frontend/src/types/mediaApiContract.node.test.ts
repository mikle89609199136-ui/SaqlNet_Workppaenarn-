import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Ajv from '@redocly/ajv';
import { describe, expect, it } from 'vitest';
import type { components } from './api.generated';

const { load } = createRequire(import.meta.url)('js-yaml') as {
  load: (source: string) => unknown;
};
type Schema = { $ref?: string; [key: string]: unknown };
type Response = { $ref?: string; content?: Record<string, { schema: Schema }> };
type Operation = {
  operationId: string;
  security: unknown[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, Response>;
};
type Fixture = { name: string; operationId: string; status: number; body: unknown };
const read = (path: string) =>
  readFileSync(new URL(`../../../backend-v2/contracts/${path}`, import.meta.url), 'utf8');
const schemas = load(read('openapi/components/schemas.yaml')) as Record<string, Schema>;
const responses = load(read('openapi/components/responses.yaml')) as Record<string, Response>;
const paths = load(read('openapi/paths/media.yaml')) as Record<string, Record<string, Operation>>;
const fixtures = JSON.parse(read('openapi/fixtures/media-api.json')) as Fixture[];
const operations = Object.values(paths).flatMap((item) =>
  Object.values(item).filter((value) => value?.operationId)
);
const api = load(read('openapi/api-v2.yaml')) as { paths: Record<string, { $ref: string }> };

// Rebase external schema refs used by path and response components.
const localRefs = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value).replace(
      /(?:\.\.\/components\/|\.\/)?schemas\.yaml#\//g,
      'urn:crane:media-contract#/'
    )
  );
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('int64', { type: 'number', validate: Number.isInteger });
ajv.addFormat('byte', /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat(
  'date-time',
  (value: string) =>
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value))
);
ajv.addSchema({ $id: 'urn:crane:media-contract', ...schemas });
const accepts = (name: string, value: unknown) =>
  ajv.compile({ $ref: `urn:crane:media-contract#/${name}` })(value);
const responseSchema = (response: Response): Schema => {
  const resolved = response.$ref ? responses[response.$ref.split('#/')[1]] : response;
  return localRefs(resolved.content!['application/json'].schema) as Schema;
};

const upload = {
  success: true,
  url: '/api/v2/media/11111111-1111-4111-8111-111111111111',
  fileName: 'note.txt',
  sizeBytes: 5,
  contentType: 'text/plain',
} satisfies components['schemas']['UploadResponse'];
const emojis = {
  emojis: [{ code: ':grinning:', img: '😀' }],
} satisfies components['schemas']['MediaEmojisResponse'];

describe('Media API contract (#614)', () => {
  it('covers all 15 published operations and separates public/protected routes', () => {
    expect(operations).toHaveLength(15);
    expect(new Set(operations.map((op) => op.operationId)).size).toBe(15);
    for (const path of Object.keys(paths).filter((path) => path.startsWith('/'))) {
      expect(api.paths[path].$ref).toContain('./paths/media.yaml#/');
    }
    for (const op of operations) {
      expect(op.security).toEqual(op.operationId === 'listEmojis' ? [] : [{ sessionCookie: [] }]);
      expect(op.responses['409']).toBeUndefined(); // Existing favorites return 200.
      if (op.operationId !== 'listEmojis') expect(op.responses['401']).toBeDefined();
      for (const [status, response] of Object.entries(op.responses)) {
        if (op.operationId === 'headMedia' || status === '416') {
          expect(response.content).toBeUndefined();
          continue;
        }
        if (status === '206') {
          expect(response.content?.['*/*'].schema).toEqual({ type: 'string', format: 'binary' });
          continue;
        }
        if (status.startsWith('2')) {
          expect(
            fixtures.some(
              (fixture) =>
                fixture.operationId === op.operationId && String(fixture.status) === status
            ),
            `${op.operationId}: ${status} needs a runtime fixture`
          ).toBe(true);
        }
        // Every JSON success/error has a schema; streams additionally allow binary bodies.
        expect(
          () => ajv.compile(responseSchema(response)),
          `${op.operationId}: ${status}`
        ).not.toThrow();
      }
    }
  });

  it.each(fixtures)('$name matches its response schema and the Go runtime fixture', (fixture) => {
    const op = operations.find((op) => op.operationId === fixture.operationId)!;
    const validate = ajv.compile(responseSchema(op.responses[String(fixture.status)]));
    expect(validate(fixture.body), JSON.stringify(validate.errors)).toBe(true);
  });

  it('requires real DTO fields, UUIDs, arrays and non-null timestamps', () => {
    expect(accepts('UploadResponse', upload)).toBe(true);
    expect(accepts('UploadResponse', { ...upload, url: '/api/v2/media/bad-id' })).toBe(false);
    expect(accepts('UploadResponse', { success: true, url: upload.url })).toBe(false);
    expect(accepts('UploadResponse', { ...upload, encryption: {} })).toBe(false);
    expect(accepts('MediaEmojisResponse', emojis)).toBe(true);
    expect(accepts('MediaEmojisResponse', { reactions: [] })).toBe(false);
    expect(accepts('MediaGifsResponse', { gifs: null })).toBe(false);
    expect(accepts('MediaTimestamp', '2026-10-28T10:20:30Z')).toBe(true);
    expect(accepts('MediaTimestamp', '2026-10-28 10:20:30.123456+00')).toBe(true);
    for (const invalid of [null, '2026-10-28', 'yesterday']) {
      expect(accepts('MediaTimestamp', invalid)).toBe(false);
    }
    for (const invalid of [{ code: 'bad' }, { message: 'bad' }, {}]) {
      expect(accepts('Error', invalid)).toBe(false);
    }
  });

  it('describes complete data URLs instead of bare base64', () => {
    expect(accepts('MediaDataUrl', 'data:image/png;base64,YQ==')).toBe(true);
    expect(accepts('MediaDataUrl', 'YQ==')).toBe(false);
    expect(accepts('MediaDataUrl', 'https://example.com/image.png')).toBe(false);
    const requestValidator = (operationId: string) =>
      ajv.compile(
        localRefs(
          operations.find((op) => op.operationId === operationId)!.requestBody!.content[
            'application/json'
          ].schema
        ) as Schema
      );
    const pack = requestValidator('createStickerPack');
    expect(pack({ name: 'Pack', icon: 'data:image/png;base64,YQ==' })).toBe(true);
    expect(pack({ name: 'Pack', description: null, icon: null })).toBe(true);
    expect(pack({ name: 'Pack', icon: 'YQ==' })).toBe(false);
    expect(pack({ name: '   ' })).toBe(false);
    const sticker = requestValidator('addSticker');
    expect(sticker({ image: 'data:image/png;base64,YQ==' })).toBe(true);
    expect(sticker({ image: 'YQ==' })).toBe(false);
  });
});

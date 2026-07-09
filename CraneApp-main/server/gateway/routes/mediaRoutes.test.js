// @vitest-environment node
import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const createMediaRoutes = require('./mediaRoutes.js');

globalThis.localStorage = globalThis.localStorage || { clear: vi.fn() };
globalThis.sessionStorage = globalThis.sessionStorage || { clear: vi.fn() };

function createTestRouter(query) {
  return createMediaRoutes({
    authMiddleware: (req, _res, next) => {
      req.user = { id: 'user-1' };
      next();
    },
    logger: { error: vi.fn(), info: vi.fn() },
    query,
    uploadLimiter: (_req, _res, next) => next(),
    uuidv4: () => 'media-1',
  });
}

function dispatch(router, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      originalUrl: url,
      headers: {},
      body,
      query: {},
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[name.toLowerCase()];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        this.setHeader('Content-Type', 'application/json; charset=utf-8');
        resolve(this);
      },
      send(payload) {
        this.body = payload;
        resolve(this);
      },
    };

    router.handle(req, res, (error) => {
      if (error) reject(error);
      else resolve(res);
    });
  });
}

describe('mediaRoutes encrypted message media', () => {
  it('accepts encrypted message media and stores ciphertext instead of a data URL', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const router = createTestRouter(query);

    const payload = {
      version: 1,
      encrypted: true,
      algorithm: 'AES-GCM',
      iv: 'iv',
      ciphertext: 'ciphertext-only',
      mimeType: 'image/png',
      sizeBytes: 12,
    };
    const response = await dispatch(router, {
      method: 'POST',
      url: '/upload',
      body: { file: payload, type: 'image', purpose: 'message' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ encrypted: true, url: '/api/v2/media/media-1' });
    expect(query.mock.calls[0][1][2]).toBe('ciphertext-only');
    expect(query.mock.calls[0][1][2]).not.toContain('data:image/png');
    expect(query.mock.calls[0][1][5]).toMatchObject({ encrypted: true, iv: 'iv', mimeType: 'image/png' });
  });

  it('returns encrypted media as a JSON payload', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        data: 'ciphertext-only',
        mime_type: 'image/png',
        size_bytes: 12,
        encrypted: true,
        encryption: { version: 1, encrypted: true, algorithm: 'AES-GCM', iv: 'iv', mimeType: 'image/png', sizeBytes: 12 },
      }],
    });
    const router = createTestRouter(query);

    const response = await dispatch(router, { method: 'GET', url: '/media/media-1' });

    expect(response.getHeader('content-type')).toContain('application/json');
    expect(response.body).toMatchObject({
      version: 1,
      encrypted: true,
      algorithm: 'AES-GCM',
      iv: 'iv',
      ciphertext: 'ciphertext-only',
      mimeType: 'image/png',
      sizeBytes: 12,
    });
  });

  it('serves legacy media without encrypted metadata as plain media', async () => {
    const dataUrl = 'data:text/plain;base64,aGVsbG8=';
    const query = vi.fn().mockResolvedValue({
      rows: [{ data: dataUrl, mime_type: 'text/plain', size_bytes: 5, encrypted: false, encryption: null }],
    });
    const router = createTestRouter(query);

    const response = await dispatch(router, { method: 'GET', url: '/media/media-1' });

    expect(response.getHeader('content-type')).toContain('text/plain');
    expect(response.body.toString()).toBe('hello');
  });
});

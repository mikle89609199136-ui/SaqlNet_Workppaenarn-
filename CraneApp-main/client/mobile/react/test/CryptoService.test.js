import { describe, it, expect, beforeEach, vi } from 'vitest';
import CryptoService from '../../application/services/CryptoService';

// Mock IndexedDB and Crypto
const mockStore = new Map();
vi.stubGlobal('indexedDB', {
  open: vi.fn().mockImplementation(() => {
    const req = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      result: {
        createObjectStore: vi.fn(),
        transaction: vi.fn().mockReturnValue({
          objectStore: vi.fn().mockReturnValue({
            get: (k) => {
              const subReq = { result: mockStore.get(k) };
              setTimeout(() => subReq.onsuccess && subReq.onsuccess(), 0);
              return subReq;
            },
            put: (v, k) => {
              mockStore.set(k, v);
              const subReq = {};
              setTimeout(() => subReq.onsuccess && subReq.onsuccess(), 0);
              return subReq;
            }
          })
        })
      }
    };
    setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
    return req;
  })
});

vi.stubGlobal('crypto', {
  subtle: {
    generateKey: vi.fn().mockResolvedValue({ privateKey: 'priv', publicKey: 'pub' }),
    exportKey: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    importKey: vi.fn().mockResolvedValue('imported_key'),
    deriveKey: vi.fn().mockResolvedValue('shared_key'),
    encrypt: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    decrypt: vi.fn().mockResolvedValue(new TextEncoder().encode('decrypted message')),
    digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  },
  getRandomValues: vi.fn().mockImplementation((arr) => arr),
});

describe('CryptoService', () => {
  let service;
  let mockApiClient;

  beforeEach(() => {
    mockStore.clear();
    localStorage.clear();
    localStorage.setItem('craneapp_user_data', JSON.stringify({ id: 'u1', username: 'ivan_1' }));
    mockApiClient = { post: vi.fn().mockResolvedValue({}), get: vi.fn().mockResolvedValue({ data: { state: 'new_state' } }) };
    service = new CryptoService(mockApiClient);
    crypto.subtle.encrypt.mockResolvedValue(new Uint8Array([4, 5, 6]));
    crypto.subtle.decrypt.mockResolvedValue(new TextEncoder().encode('decrypted message'));
    crypto.getRandomValues.mockImplementation((arr) => arr);
  });

  it('should initialize and generate keys if none exist', async () => {
    await service.init();
    expect(service.privateKey).toBe('priv');
    expect(mockStore.has('signal_keypair:u1')).toBe(true);
    expect(mockApiClient.post).toHaveBeenCalled();
  });

  it('should load existing keys on relogin without losing them', async () => {
    mockStore.set('signal_keypair:u1', { privateKey: 'existing_priv', publicKey: 'existing_pub' });
    await service.init();
    expect(service.privateKey).toBe('existing_priv');
    expect(mockApiClient.post).toHaveBeenCalledWith('/auth/public-key', { publicKey: 'AQID' });
  });

  it('keeps separate Signal keys per account across logout and login', async () => {
    mockStore.set('signal_keypair:u1', { privateKey: 'u1_priv', publicKey: 'u1_pub' });
    mockStore.set('signal_keypair:u2', { privateKey: 'u2_priv', publicKey: 'u2_pub' });

    await service.init();
    expect(service.privateKey).toBe('u1_priv');

    localStorage.setItem('craneapp_user_data', JSON.stringify({ id: 'u2', username: 'anna_1' }));
    service.ready = false;
    await service.init();

    expect(service.privateKey).toBe('u2_priv');
  });

  it('does not generate anonymous keys before login', async () => {
    localStorage.clear();
    await service.init();

    expect(mockStore.size).toBe(0);
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it('should encrypt and decrypt DM correctly', async () => {
    await service.init();
    const encrypted = await service.encryptDM('hello', 'bW9jaw==');
    expect(JSON.parse(encrypted).e2e).toBe(true);
    
    const decrypted = await service.decryptDM(encrypted, 'bW9jaw==');
    expect(decrypted).toBe('decrypted message');
  });

  it('should catch up MLS state if decryption fails or state is missing', async () => {
    const content = await service.encryptGroup('chat1', 'hello');
    expect(content.startsWith('[MLS]')).toBe(true);
    expect(mockApiClient.get).toHaveBeenCalledWith('/chats/chat1/mls-state'); // Fetched state because none existed
    expect(mockStore.has('mls_state:u1:chat1')).toBe(true);
  });

  it('encrypts and decrypts media data URLs as AES-GCM payloads', async () => {
    await service.init();
    crypto.subtle.encrypt.mockImplementation(async (_algorithm, _key, data) => data);
    crypto.subtle.decrypt.mockImplementation(async (_algorithm, _key, data) => data);
    crypto.getRandomValues.mockImplementation((arr) => {
      arr.fill(7);
      return arr;
    });

    const encrypted = await service.encryptMedia('chat1', 'data:text/plain;base64,aGVsbG8=', { peerPublicKey: 'bW9jaw==' });
    const decrypted = await service.decryptMedia('chat1', encrypted, { peerPublicKey: 'bW9jaw==' });

    expect(encrypted).toMatchObject({
      version: 1,
      encrypted: true,
      algorithm: 'AES-GCM',
      mimeType: 'text/plain',
      sizeBytes: 5,
    });
    expect(encrypted.ciphertext).not.toContain('hello');
    await expect(decrypted.text()).resolves.toBe('hello');
  });

  it('uses different IVs for identical media payloads', async () => {
    await service.init();
    let counter = 0;
    crypto.subtle.encrypt.mockResolvedValue(new Uint8Array([9, 9, 9]));
    crypto.getRandomValues.mockImplementation((arr) => {
      counter += 1;
      arr.fill(counter);
      return arr;
    });

    const first = await service.encryptMedia('chat1', 'data:text/plain;base64,aGVsbG8=', { peerPublicKey: 'bW9jaw==' });
    const second = await service.encryptMedia('chat1', 'data:text/plain;base64,aGVsbG8=', { peerPublicKey: 'bW9jaw==' });

    expect(first.iv).not.toBe(second.iv);
  });

  it('fails media decryption for corrupted ciphertext or the wrong key', async () => {
    await service.init();
    crypto.subtle.decrypt.mockRejectedValue(new Error('decrypt failed'));

    await expect(service.decryptMedia('chat1', {
      version: 1,
      encrypted: true,
      algorithm: 'AES-GCM',
      iv: 'AQID',
      ciphertext: 'BAUG',
      mimeType: 'text/plain',
      sizeBytes: 3,
    }, { peerPublicKey: 'bW9jaw==' })).rejects.toThrow('decrypt failed');
  });
});

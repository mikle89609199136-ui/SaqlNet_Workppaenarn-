import type { ApiClient } from '@/api';
import { STORAGE_KEYS } from '@/consts';
import type { IEncryptedMedia, IMlsStateResponse, TChatType } from '@/types';

const E2E_UNAVAILABLE_MESSAGE = '🔒 [E2E недоступно: нужен HTTPS или localhost]';

export interface IStoredKeys {
  privateKey?: CryptoKey;
  publicKey?: CryptoKey;
  privateJwk?: JsonWebKey;
  publicJwk?: JsonWebKey;
}

export interface IChatContext {
  type?: TChatType;
  peerPublicKey?: string | null;
  recipientPublicKey?: string | null;
  senderPublicKey?: string | null;
  publicKey?: string | null;
}

export interface IMediaInput {
  bytes: ArrayBuffer;
  mimeType: string;
  fileName?: string;
}

export interface IDecryptOptions {
  preferEmbeddedSenderKey?: boolean;
}

export interface IDecryptDebugInfo {
  accountId: string | null;
  preferEmbeddedSenderKey: boolean;
  localPublicKeyFp: string | null;
  payloadRecipientKeyFp: string | null;
  payloadSenderKeyFp: string | null;
  fallbackPeerKeyFp: string | null;
}

export interface IE2EPayload {
  e2e?: boolean;
  iv?: string;
  data?: string;
  senderPublicKey?: string;
  senderKeyFp?: string;
  recipientKeyFp?: string;
  recipientPublicKey?: string;
}

export class CryptoService {
  private apiClient: ApiClient;
  private dbName = 'craneapp_crypto';
  private dbVersion = 1;
  private storeName = 'keys';

  private privateKey: CryptoKey | null = null;
  private publicKey: CryptoKey | null = null;

  private groupStates = new Map<string, any>();
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private publicKeyUploaded = false;
  private accountId: string | null = null;

  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async init(): Promise<void> {
    const accountId = this.getAccountId();
    if (!accountId) return;

    if (!this.hasWebCrypto()) return;

    if (this.ready && this.accountId === accountId) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit(accountId);

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async doInit(accountId: string): Promise<void> {
    await this.initDB();

    this.accountId = accountId;

    const storedKeys = await this.dbGet(this.keypairKey());

    if (storedKeys) {
      await this.loadStoredKeypair(storedKeys);
    } else {
      await this.generateAndStoreKeys();
    }

    if (!this.publicKeyUploaded) {
      await this.uploadPublicKey();
      this.publicKeyUploaded = true;
    }

    this.ready = true;
  }

  getAccountId(): string | null {
    try {
      const user = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null');
      return user?.id || user?.username || null;
    } catch (_error) {
      return null;
    }
  }

  keypairKey(): string {
    return `signal_keypair:${this.accountId}`;
  }

  groupStateKey(chatId: string): string {
    return `mls_state:${this.accountId}:${chatId}`;
  }

  hasWebCrypto(): boolean {
    return Boolean(globalThis.crypto?.subtle);
  }

  // --- IndexedDB ---
  initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = (e: Event) => resolve((e.target as IDBOpenDBRequest).result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        console.warn('IndexedDB open blocked — another connection is holding an upgrade');
      };
    });

    return this.dbPromise;
  }

  async dbGet<T = unknown>(key: string): Promise<T | undefined> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async dbSet(key: string, value: unknown): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // --- Utils ---
  bufToB64(buf: ArrayBuffer | Uint8Array): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  b64ToBuf(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  // --- E2E Keys ---
  async loadStoredKeypair(storedKeys: IStoredKeys): Promise<void> {
    if (storedKeys.privateJwk && storedKeys.publicJwk) {
      this.privateKey = await crypto.subtle.importKey(
        'jwk',
        storedKeys.privateJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
      );
      this.publicKey = await crypto.subtle.importKey(
        'jwk',
        storedKeys.publicJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );
      return;
    }

    if (storedKeys.privateKey && storedKeys.publicKey) {
      this.privateKey = storedKeys.privateKey;
      this.publicKey = storedKeys.publicKey;
    }
  }

  async generateAndStoreKeys(): Promise<void> {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveKey',
      'deriveBits',
    ]);
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    await this.dbSet(this.keypairKey(), {
      privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
      publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    });
    await this.uploadPublicKey();
  }

  async uploadPublicKey(): Promise<void> {
    if (this.publicKeyUploaded) return;
    if (!this.publicKey || !this.hasWebCrypto()) return;
    const pubRaw = await crypto.subtle.exportKey('spki', this.publicKey);
    const pubB64 = this.bufToB64(pubRaw);
    try {
      await this.apiClient.post('/auth/public-key', { publicKey: pubB64 });
      console.debug('🔐 Crypto: public key uploaded', {
        accountId: this.accountId,
        keyFp: await this.publicKeyFingerprint(pubB64),
      });
    } catch (e) {
      console.error('Failed to upload public key', e);
    }
  }

  // --- Encryption/Decryption ---
  async encryptDM(content: string, recipientPubKeyB64: string): Promise<string> {
    if (!content) return content;
    if (!recipientPubKeyB64) return content;
    if (!this.hasWebCrypto()) return content;
    if (!this.privateKey) return content;
    if (!this.ready) {
      try {
        await this.init();
      } catch (e) {
        console.warn('Crypto init failed during encryptDM, sending unencrypted', e);
        return content;
      }
    }

    // Simplistic mock of Signal/ECDH for demo purposes based on legacy
    try {
      const peerKey = await crypto.subtle.importKey(
        'spki',
        this.b64ToBuf(recipientPubKeyB64),
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );

      const sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: peerKey },
        this.privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = new TextEncoder().encode(content);
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, enc);
      const senderPublicKey = await this.exportPublicKey();
      const senderKeyFp = await this.publicKeyFingerprint(senderPublicKey);
      const recipientKeyFp = await this.publicKeyFingerprint(recipientPubKeyB64);

      return JSON.stringify({
        e2e: true,
        iv: this.bufToB64(iv),
        data: this.bufToB64(ciphertext),
        senderPublicKey,
        senderKeyFp,
        recipientPubKeyB64: recipientPubKeyB64,
        recipientKeyFp,
      });
    } catch (e) {
      console.warn('E2E Encrypt failed:', e);
      return content;
    }
  }

  async deriveDMKey(peerPubKeyB64: string | null, usages: KeyUsage[]): Promise<CryptoKey> {
    if (!this.hasWebCrypto()) {
      throw new Error('WebCrypto is unavailable. Open the app via HTTPS or localhost for E2E.');
    }
    if (!this.ready) await this.init();
    if (!peerPubKeyB64) {
      throw new Error('Missing peer public key for E2E media encryption');
    }
    if (!this.privateKey) {
      throw new Error('Missing local private key');
    }

    const peerKey = await crypto.subtle.importKey(
      'spki',
      this.b64ToBuf(peerPubKeyB64),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );

    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerKey },
      this.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
  }

  async decryptDM(
    payloadStr: string,
    senderPubKeyB64: string,
    options: IDecryptOptions = {}
  ): Promise<string> {
    try {
      if (!payloadStr.startsWith('{')) return payloadStr; // not json
      const payload: IE2EPayload = JSON.parse(payloadStr);
      if (!payload.e2e || !payload.iv || !payload.data) return payloadStr;
      if (!this.hasWebCrypto()) return E2E_UNAVAILABLE_MESSAGE;
      if (!this.ready) await this.init();
      if (!this.privateKey) return E2E_UNAVAILABLE_MESSAGE;
      const preferEmbeddedSenderKey = options.preferEmbeddedSenderKey !== false;
      const senderKey = preferEmbeddedSenderKey
        ? payload.senderPublicKey || senderPubKeyB64
        : payload.recipientPublicKey || senderPubKeyB64;
      if (!senderKey) return '🔒 [Отсутствует публичный ключ отправителя]';

      const peerKey = await crypto.subtle.importKey(
        'spki',
        this.b64ToBuf(senderKey),
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );

      const sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: peerKey },
        this.privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: this.b64ToBuf(payload.iv) },
        sharedKey,
        this.b64ToBuf(payload.data)
      );

      return new TextDecoder().decode(decrypted);
    } catch (e) {
      const debugInfo = await this.decryptDebugInfo(payloadStr, senderPubKeyB64, options);
      console.warn('E2E Decrypt failed:', e, debugInfo);

      const keyMismatch =
        debugInfo.localPublicKeyFp &&
        debugInfo.payloadRecipientKeyFp &&
        debugInfo.localPublicKeyFp !== debugInfo.payloadRecipientKeyFp;

      return keyMismatch
        ? '🔒 [Ключ собеседника изменился — сообщение больше не расшифровывается]'
        : '🔒 [Ошибка расшифровки E2E]';
    }
  }

  async exportPublicKey(): Promise<string | null> {
    if (!this.publicKey || !this.hasWebCrypto()) return null;
    const pubRaw = await crypto.subtle.exportKey('spki', this.publicKey);
    return this.bufToB64(pubRaw);
  }

  async publicKeyFingerprint(publicKeyB64: string | null) {
    if (!publicKeyB64 || !globalThis.crypto?.subtle?.digest) return null;
    const hash = await crypto.subtle.digest('SHA-256', this.b64ToBuf(publicKeyB64));
    return this.bufToB64(hash).slice(0, 12);
  }

  async localPublicKeyFingerprint() {
    return this.publicKeyFingerprint(await this.exportPublicKey());
  }

  async decryptDebugInfo(
    payloadStr: string,
    senderPubKeyB64: string,
    options: IDecryptOptions = {}
  ): Promise<Promise<IDecryptDebugInfo>> {
    let payload: IE2EPayload = {};
    try {
      payload = JSON.parse(payloadStr);
    } catch (_error) {}

    return {
      accountId: this.accountId || null,
      preferEmbeddedSenderKey: options.preferEmbeddedSenderKey !== false,
      localPublicKeyFp: await this.localPublicKeyFingerprint(),
      payloadRecipientKeyFp: payload.recipientKeyFp || null,
      payloadSenderKeyFp: payload.senderKeyFp || null,
      fallbackPeerKeyFp: await this.publicKeyFingerprint(senderPubKeyB64),
    };
  }

  // --- MLS Groups ---
  async syncGroupState(chatId: string): Promise<boolean> {
    try {
      const res = await this.apiClient.get<IMlsStateResponse>(`/chats/${chatId}/mls-state`);
      if (res.data && res.data.state) {
        this.groupStates.set(chatId, res.data.state);
        await this.dbSet(this.groupStateKey(chatId), res.data.state);
        return true;
      }
    } catch (e) {
      console.warn('MLS sync failed:', e);
    }
    return false;
  }

  async encryptGroup(chatId: string, content: string): Promise<string> {
    if (!this.ready) await this.init();
    const state = this.groupStates.get(chatId) || (await this.dbGet(this.groupStateKey(chatId)));
    if (!state) {
      await this.syncGroupState(chatId);
    }

    // Mock MLS encryption based on legacy script
    return `[MLS]${btoa(encodeURIComponent(content))}`;
  }

  async decryptGroup(chatId: string, payload: string): Promise<string> {
    if (!payload.startsWith('[MLS]')) return payload;

    if (!this.ready) await this.init();
    let state = this.groupStates.get(chatId) || (await this.dbGet(this.groupStateKey(chatId)));
    if (!state) {
      const synced = await this.syncGroupState(chatId);
      if (!synced) return '🔒 [зашифровано MLS - Ожидание синхронизации]';
    }

    try {
      const b64 = payload.substring(5);
      return decodeURIComponent(atob(b64));
    } catch (e) {
      this.syncGroupState(chatId);
      return '🔒 [ошибка расшифровки MLS - Синхронизация...]';
    }
  }

  async encryptMedia(
    chatId: string,
    dataUrlOrBlob: string | Blob,
    chatContext: IChatContext = {}
  ): Promise<IEncryptedMedia> {
    const input = await this.normalizeMediaInput(dataUrlOrBlob);
    const key = await this.getMediaKey(chatId, chatContext, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, input.bytes);

    return {
      version: 1,
      encrypted: true,
      algorithm: 'AES-GCM',
      iv: this.bufToB64(iv),
      ciphertext: this.bufToB64(ciphertext),
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      ...(input.fileName ? { fileName: input.fileName } : {}),
    };
  }

  async decryptMedia(
    chatId: string,
    encryptedMedia: IEncryptedMedia,
    chatContext: IChatContext = {}
  ): Promise<Blob> {
    if (!encryptedMedia || encryptedMedia.encrypted !== true || encryptedMedia.version !== 1) {
      throw new Error('Encrypted media payload expected');
    }
    if (
      encryptedMedia.algorithm !== 'AES-GCM' ||
      !encryptedMedia.iv ||
      !encryptedMedia.ciphertext
    ) {
      throw new Error('Unsupported encrypted media payload');
    }

    const key = await this.getMediaKey(chatId, chatContext, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.b64ToBuf(encryptedMedia.iv) },
      key,
      this.b64ToBuf(encryptedMedia.ciphertext)
    );

    return new Blob([plaintext], {
      type: encryptedMedia.mimeType || 'application/octet-stream',
    });
  }

  async getMediaKey(
    chatId: string,
    chatContext: IChatContext = {},
    usages: KeyUsage[] = ['encrypt', 'decrypt']
  ): Promise<CryptoKey> {
    const chatType = chatContext.type || 'private';
    if (chatType === 'group' || chatType === 'channel') {
      return this.deriveGroupMediaKey(chatId, usages);
    }
    const peerKey =
      chatContext.peerPublicKey ||
      chatContext.recipientPublicKey ||
      chatContext.senderPublicKey ||
      chatContext.publicKey ||
      null;
    return this.deriveDMKey(peerKey, usages);
  }

  async deriveGroupMediaKey(chatId: string, usages: KeyUsage[]): Promise<CryptoKey> {
    if (!this.ready) await this.init();
    let state = this.groupStates.get(chatId) || (await this.dbGet(this.groupStateKey(chatId)));
    if (!state) {
      await this.syncGroupState(chatId);
      state = this.groupStates.get(chatId) || (await this.dbGet(this.groupStateKey(chatId)));
    }
    if (!state) {
      throw new Error('Missing group encryption state for media');
    }

    const material = JSON.stringify({
      purpose: 'craneapp-media-v1',
      chatId,
      state,
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, usages);
  }

  async normalizeMediaInput(dataUrlOrBlob: string | Blob | File): Promise<IMediaInput> {
    if (typeof Blob !== 'undefined' && dataUrlOrBlob instanceof Blob) {
      if (dataUrlOrBlob instanceof File) {
        return {
          bytes: await dataUrlOrBlob.arrayBuffer(),
          mimeType: dataUrlOrBlob.type || 'application/octet-stream',
          fileName: dataUrlOrBlob.name,
        };
      }
      return {
        bytes: await dataUrlOrBlob.arrayBuffer(),
        mimeType: dataUrlOrBlob.type || 'application/octet-stream',
        fileName: undefined,
      };
    }

    if (typeof dataUrlOrBlob === 'string') {
      const match = dataUrlOrBlob.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) {
        throw new Error('Media must be a data URL or Blob');
      }
      return {
        bytes: this.b64ToBuf(match[2]),
        mimeType: match[1] || 'application/octet-stream',
      };
    }

    throw new Error('Unsupported media input');
  }
}

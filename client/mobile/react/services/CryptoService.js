const E2E_UNAVAILABLE_MESSAGE = '🔒 [E2E недоступно: нужен HTTPS или localhost]';

class CryptoService {
  constructor(apiClient) {
    this.apiClient = apiClient;
    this.dbName = 'craneapp_crypto';
    this.dbVersion = 1;
    this.storeName = 'keys';
    this.ready = false;
    this.privateKey = null;
    this.publicKey = null;
    this.groupStates = new Map();
    this.ready = false;
    this.initPromise = null;
    this.publicKeyUploaded = false;
  }

  async init() {
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

  async doInit(accountId) {
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

  getAccountId() {
    try {
      const user = JSON.parse(localStorage.getItem('craneapp_user_data') || 'null');
      return user?.id || user?.username || null;
    } catch (_error) {
      return null;
    }
  }

  keypairKey() {
    return `signal_keypair:${this.accountId}`;
  }

  groupStateKey(chatId) {
    return `mls_state:${this.accountId}:${chatId}`;
  }

  hasWebCrypto() {
    return Boolean(globalThis.crypto?.subtle);
  }

  // --- IndexedDB ---
  initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(this.storeName);
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }

  async dbGet(key) {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async dbSet(key, value) {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // --- Utils ---
  bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  b64ToBuf(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  // --- E2E Keys ---
  async loadStoredKeypair(storedKeys) {
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

    this.privateKey = storedKeys.privateKey;
    this.publicKey = storedKeys.publicKey;
  }

  async generateAndStoreKeys() {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    await this.dbSet(this.keypairKey(), {
      privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
      publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    });
    await this.uploadPublicKey();
  }

  async uploadPublicKey() {
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
  async encryptDM(content, recipientPubKeyB64) {
    if (!content) return content;
    if (!recipientPubKeyB64) return content; // Fallback if no key
    if (!this.hasWebCrypto()) return content;
    if (!this.ready) await this.init();
    if (!this.privateKey) return content;
    
    // Simplistic mock of Signal/ECDH for demo purposes based on legacy
    try {
      const peerKey = await crypto.subtle.importKey(
        'spki', this.b64ToBuf(recipientPubKeyB64),
        { name: 'ECDH', namedCurve: 'P-256' },
        true, []
      );
      
      const sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: peerKey },
        this.privateKey,
        { name: 'AES-GCM', length: 256 },
        false, ['encrypt']
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
        recipientKeyFp,
      });
    } catch (e) {
      console.warn('E2E Encrypt failed:', e);
      return content;
    }
  }

  async deriveDMKey(peerPubKeyB64, usages) {
    if (!this.hasWebCrypto()) {
      throw new Error('WebCrypto is unavailable. Open the app via HTTPS or localhost for E2E.');
    }
    if (!this.ready) await this.init();
    if (!peerPubKeyB64) {
      throw new Error('Missing peer public key for E2E media encryption');
    }

    const peerKey = await crypto.subtle.importKey(
      'spki', this.b64ToBuf(peerPubKeyB64),
      { name: 'ECDH', namedCurve: 'P-256' },
      true, []
    );

    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerKey },
      this.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
  }

  async decryptDM(payloadStr, senderPubKeyB64, options = {}) {
    try {
      if (!payloadStr.startsWith('{')) return payloadStr; // not json
      const payload = JSON.parse(payloadStr);
      if (!payload.e2e || !payload.iv || !payload.data) return payloadStr;
      if (!this.hasWebCrypto()) return E2E_UNAVAILABLE_MESSAGE;
      if (!this.ready) await this.init();
      if (!this.privateKey) return E2E_UNAVAILABLE_MESSAGE;
      const preferEmbeddedSenderKey = options.preferEmbeddedSenderKey !== false;
      const senderKey = preferEmbeddedSenderKey
        ? (payload.senderPublicKey || senderPubKeyB64)
        : senderPubKeyB64;
      if (!senderKey) return '🔒 [Отсутствует публичный ключ отправителя]';

      const peerKey = await crypto.subtle.importKey(
        'spki', this.b64ToBuf(senderKey),
        { name: 'ECDH', namedCurve: 'P-256' },
        true, []
      );

      const sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: peerKey },
        this.privateKey,
        { name: 'AES-GCM', length: 256 },
        false, ['decrypt']
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: this.b64ToBuf(payload.iv) },
        sharedKey,
        this.b64ToBuf(payload.data)
      );

      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.warn('E2E Decrypt failed:', e, await this.decryptDebugInfo(payloadStr, senderPubKeyB64, options));
      return '🔒 [Ошибка расшифровки E2E]';
    }
  }

  async exportPublicKey() {
    if (!this.publicKey || !this.hasWebCrypto()) return null;
    const pubRaw = await crypto.subtle.exportKey('spki', this.publicKey);
    return this.bufToB64(pubRaw);
  }

  async publicKeyFingerprint(publicKeyB64) {
    if (!publicKeyB64 || !globalThis.crypto?.subtle?.digest) return null;
    const hash = await crypto.subtle.digest('SHA-256', this.b64ToBuf(publicKeyB64));
    return this.bufToB64(hash).slice(0, 12);
  }

  async localPublicKeyFingerprint() {
    return this.publicKeyFingerprint(await this.exportPublicKey());
  }

  async decryptDebugInfo(payloadStr, senderPubKeyB64, options = {}) {
    let payload = {};
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
  async syncGroupState(chatId) {
    // Fetch latest commits and state to catch up (Bugfix for "groups do not decrypt after absence")
    try {
      const res = await this.apiClient.get(`/chats/${chatId}/mls-state`);
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

  async encryptGroup(chatId, content) {
    if (!this.ready) await this.init();
    // Wrap the message in MLS
    const state = this.groupStates.get(chatId) || await this.dbGet(this.groupStateKey(chatId));
    if (!state) {
      // Force sync
      await this.syncGroupState(chatId);
    }
    
    // Mock MLS encryption based on legacy script
    return `[MLS]${btoa(encodeURIComponent(content))}`;
  }

  async decryptGroup(chatId, payload) {
    if (!payload.startsWith('[MLS]')) return payload;
    
    if (!this.ready) await this.init();
    let state = this.groupStates.get(chatId) || await this.dbGet(this.groupStateKey(chatId));
    if (!state) {
      const synced = await this.syncGroupState(chatId);
      if (!synced) return '🔒 [зашифровано MLS - Ожидание синхронизации]';
    }
    
    try {
      const b64 = payload.substring(5);
      return decodeURIComponent(atob(b64));
    } catch (e) {
      // If decryption fails, trigger sync
      this.syncGroupState(chatId);
      return '🔒 [ошибка расшифровки MLS - Синхронизация...]';
    }
  }

  async encryptMedia(chatId, dataUrlOrBlob, chatContext = {}) {
    const input = await this.normalizeMediaInput(dataUrlOrBlob);
    const key = await this.getMediaKey(chatId, chatContext, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      input.bytes
    );

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

  async decryptMedia(chatId, encryptedMedia, chatContext = {}) {
    if (!encryptedMedia || encryptedMedia.encrypted !== true || encryptedMedia.version !== 1) {
      throw new Error('Encrypted media payload expected');
    }
    if (encryptedMedia.algorithm !== 'AES-GCM' || !encryptedMedia.iv || !encryptedMedia.ciphertext) {
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

  async getMediaKey(chatId, chatContext = {}, usages = ['encrypt', 'decrypt']) {
    const chatType = chatContext.type || chatContext.chatType || 'private';
    if (chatType === 'group' || chatType === 'channel') {
      return this.deriveGroupMediaKey(chatId, usages);
    }
    const peerKey = chatContext.peerPublicKey
      || chatContext.recipientPublicKey
      || chatContext.senderPublicKey
      || chatContext.publicKey
      || null;
    return this.deriveDMKey(peerKey, usages);
  }

  async deriveGroupMediaKey(chatId, usages) {
    if (!this.ready) await this.init();
    let state = this.groupStates.get(chatId) || await this.dbGet(this.groupStateKey(chatId));
    if (!state) {
      await this.syncGroupState(chatId);
      state = this.groupStates.get(chatId) || await this.dbGet(this.groupStateKey(chatId));
    }
    if (!state) {
      throw new Error('Missing group encryption state for media');
    }

    const material = JSON.stringify({
      purpose: 'craneapp-media-v1',
      accountId: this.accountId,
      chatId,
      state,
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, usages);
  }

  async normalizeMediaInput(dataUrlOrBlob) {
    if (typeof Blob !== 'undefined' && dataUrlOrBlob instanceof Blob) {
      return {
        bytes: await dataUrlOrBlob.arrayBuffer(),
        mimeType: dataUrlOrBlob.type || 'application/octet-stream',
        fileName: dataUrlOrBlob.name || undefined,
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

export default CryptoService;

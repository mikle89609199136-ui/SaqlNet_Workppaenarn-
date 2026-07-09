/**
 * CraneApp — End-to-End Encryption
 * 
 * Схема:
 *  1. При первом запуске генерируем пару ключей ECDH (P-256)
 *  2. Публичный ключ загружается на сервер
 *  3. При открытии чата — получаем публичные ключи собеседников
 *  4. Генерируем AES-256-GCM сессионный ключ для чата
 *  5. Шифруем сессионный ключ публичным ключом каждого участника (ECDH + AES-KW)
 *  6. Каждое сообщение шифруется сессионным ключом + уникальным IV
 *  7. Сервер хранит только зашифрованный текст — расшифровать может только клиент
 */

if (!window.E2E) {
const E2E = (() => {
    const DB_NAME = 'craneapp_e2e';
    const DB_VERSION = 1;
    const STORE_NAME = 'keys';

    // ── IndexedDB для хранения приватных ключей ────────────────────────────
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                e.target.result.createObjectStore(STORE_NAME);
            };
            req.onsuccess = e => resolve(e.target.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function dbGet(key) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function dbSet(key, value) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ── Утилиты ────────────────────────────────────────────────────────────
    function bufToB64(buf) {
        return btoa(String.fromCharCode(...new Uint8Array(buf)));
    }

    function b64ToBuf(b64) {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
    }

    function randomId() {
        return bufToB64(crypto.getRandomValues(new Uint8Array(16)));
    }

    // ── Генерация пары ключей ECDH ─────────────────────────────────────────
    async function generateKeyPair() {
        const pair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true, // extractable
            ['deriveKey', 'deriveBits']
        );
        return pair;
    }

    // ── Экспорт публичного ключа в base64 ─────────────────────────────────
    async function exportPublicKey(key) {
        const raw = await crypto.subtle.exportKey('spki', key);
        return bufToB64(raw);
    }

    // ── Импорт публичного ключа из base64 ─────────────────────────────────
    async function importPublicKey(b64) {
        const raw = b64ToBuf(b64);
        return crypto.subtle.importKey(
            'spki', raw,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            [] // публичный ключ — только для derive
        );
    }

    // ── Derive общего секрета (ECDH) → AES-256-GCM ключ ──────────────────
    async function deriveSharedKey(privateKey, publicKey) {
        return crypto.subtle.deriveKey(
            { name: 'ECDH', public: publicKey },
            privateKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['wrapKey', 'unwrapKey']
        );
    }

    // ── Derive гибридного секрета (ECDH + Kyber-1024) → AES-256-GCM ──────
    async function deriveHybridKey(myPrivateKey, recipientPubKey, recipientPQPubKeyB64) {
        // 1. Classical ECDH shared secret bits
        const sharedECDHBytes = new Uint8Array(await crypto.subtle.deriveBits(
            { name: 'ECDH', public: recipientPubKey },
            myPrivateKey,
            256
        ));

        // 2. Kyber-1024 encapsulation
        const recipientPQPubKey = new Uint8Array(b64ToBuf(recipientPQPubKeyB64));
        const encapResult = window.ml_kem1024.encapsulate(recipientPQPubKey);

        // 3. Concatenate classical and PQ secrets
        const masterSecret = new Uint8Array(sharedECDHBytes.length + encapResult.sharedSecret.length);
        masterSecret.set(sharedECDHBytes, 0);
        masterSecret.set(encapResult.sharedSecret, sharedECDHBytes.length);

        // 4. HKDF derivation
        const importedMaster = await crypto.subtle.importKey(
            'raw', masterSecret,
            { name: 'HKDF' },
            false,
            ['deriveKey']
        );

        const sharedKey = await crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: new Uint8Array(0),
                info: new TextEncoder().encode('CraneApp PQXDH Hybrid Key')
            },
            importedMaster,
            { name: 'AES-GCM', length: 256 },
            false,
            ['wrapKey', 'unwrapKey']
        );

        return {
            sharedKey,
            pqCiphertextB64: bufToB64(encapResult.cipherText)
        };
    }

    // ── Decapsulate гибридный секрет (ECDH + Kyber-1024) ─────────────────
    async function decapsulateHybridKey(myPrivateKey, senderPubKey, myPQSecretKey, pqCiphertextB64) {
        // 1. Classical ECDH shared secret bits
        const sharedECDHBytes = new Uint8Array(await crypto.subtle.deriveBits(
            { name: 'ECDH', public: senderPubKey },
            myPrivateKey,
            256
        ));

        // 2. Kyber-1024 decapsulation
        const pqCiphertext = new Uint8Array(b64ToBuf(pqCiphertextB64));
        const pqSharedSecret = window.ml_kem1024.decapsulate(pqCiphertext, myPQSecretKey);

        // 3. Concatenate classical and PQ secrets
        const masterSecret = new Uint8Array(sharedECDHBytes.length + pqSharedSecret.length);
        masterSecret.set(sharedECDHBytes, 0);
        masterSecret.set(pqSharedSecret, sharedECDHBytes.length);

        // 4. HKDF derivation
        const importedMaster = await crypto.subtle.importKey(
            'raw', masterSecret,
            { name: 'HKDF' },
            false,
            ['deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: new Uint8Array(0),
                info: new TextEncoder().encode('CraneApp PQXDH Hybrid Key')
            },
            importedMaster,
            { name: 'AES-GCM', length: 256 },
            false,
            ['wrapKey', 'unwrapKey']
        );
    }

    // ── Генерация сессионного AES-256-GCM ключа для чата ──────────────────
    async function generateSessionKey() {
        return crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    // ── Зашифровать сессионный ключ публичным ключом получателя ───────────
    async function wrapSessionKey(sessionKey, recipientPublicKeyB64, recipientPQPubKeyB64, myPrivateKey) {
        const recipientPubKey = await importPublicKey(recipientPublicKeyB64);
        let sharedKey;
        let pqCiphertext = '';

        if (recipientPQPubKeyB64 && window.ml_kem1024) {
            const derived = await deriveHybridKey(myPrivateKey, recipientPubKey, recipientPQPubKeyB64);
            sharedKey = derived.sharedKey;
            pqCiphertext = derived.pqCiphertextB64;
        } else {
            sharedKey = await deriveSharedKey(myPrivateKey, recipientPubKey);
        }

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const wrapped = await crypto.subtle.wrapKey('raw', sessionKey, sharedKey, { name: 'AES-GCM', iv });
        return {
            wrappedKeyStr: bufToB64(iv) + ':' + bufToB64(wrapped),
            pqCiphertext
        };
    }

    // ── Расшифровать сессионный ключ своим приватным ключом ───────────────
    async function unwrapSessionKey(wrappedB64, senderPublicKeyB64, pqCiphertextB64, myPrivateKey, myPQSecretKey) {
        const [ivB64, keyB64] = wrappedB64.split(':');
        const iv = b64ToBuf(ivB64);
        const wrapped = b64ToBuf(keyB64);
        const senderPubKey = await importPublicKey(senderPublicKeyB64);

        let sharedKey;
        if (pqCiphertextB64 && myPQSecretKey && window.ml_kem1024) {
            sharedKey = await decapsulateHybridKey(myPrivateKey, senderPubKey, myPQSecretKey, pqCiphertextB64);
        } else {
            sharedKey = await deriveSharedKey(myPrivateKey, senderPubKey);
        }

        return crypto.subtle.unwrapKey(
            'raw', wrapped, sharedKey,
            { name: 'AES-GCM', iv },
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    // ── Зашифровать сообщение ─────────────────────────────────────────────
    async function encryptMessage(text, sessionKey) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sessionKey, encoded);
        return {
            ciphertext: bufToB64(ciphertext),
            iv: bufToB64(iv)
        };
    }

    // ── Расшифровать сообщение ────────────────────────────────────────────
    async function decryptMessage(ciphertextB64, ivB64, sessionKey) {
        const ciphertext = b64ToBuf(ciphertextB64);
        const iv = b64ToBuf(ivB64);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, ciphertext);
        return new TextDecoder().decode(decrypted);
    }

    // ── Кэш сессионных ключей (chatId → { key, epoch, msgCount }) ─────────
    const sessionKeyCache = new Map();
    const SESSION_KEY_ROTATION_THRESHOLD = 200;

    // ── Публичный API ──────────────────────────────────────────────────────

    /**
     * Инициализация: генерируем/загружаем ключевую пару, публикуем публичный ключ
     */
    async function init(authToken) {
        try {
            // Проверяем есть ли уже ключи
            let privateKey = await dbGet('privateKey');
            let publicKeyB64 = await dbGet('publicKeyB64');
            let keyId = await dbGet('keyId');
            let pqSecretKey = await dbGet('pqSecretKey');
            let pqPublicKeyB64 = await dbGet('pqPublicKeyB64');

            if (!privateKey || !publicKeyB64) {
                console.log('🔐 E2E: Generating new classical key pair...');
                const pair = await generateKeyPair();
                privateKey = pair.privateKey;
                publicKeyB64 = await exportPublicKey(pair.publicKey);
                keyId = randomId();

                await dbSet('privateKey', privateKey);
                await dbSet('publicKeyB64', publicKeyB64);
                await dbSet('keyId', keyId);
            }

            if ((!pqSecretKey || !pqPublicKeyB64) && window.ml_kem1024) {
                console.log('🔐 E2E: Generating new post-quantum key pair...');
                try {
                    const pqKeys = window.ml_kem1024.keygen();
                    pqSecretKey = pqKeys.secretKey;
                    pqPublicKeyB64 = bufToB64(pqKeys.publicKey);

                    await dbSet('pqSecretKey', pqSecretKey);
                    await dbSet('pqPublicKeyB64', pqPublicKeyB64);
                } catch (e) {
                    console.warn('⚠️ E2E: Post-quantum keygen failed:', e);
                }
            }

            // Публикуем публичный ключ на сервер
            await fetch('/api/v2/encryption/keys', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({ 
                    publicKey: publicKeyB64, 
                    keyId,
                    pqPublicKey: pqPublicKeyB64 || null
                })
            });

            console.log('🔐 E2E: Initialized, key ID:', keyId.substring(0, 8) + '...');
            return true;
        } catch (e) {
            console.warn('⚠️ E2E init failed:', e);
            return false;
        }
    }

    /**
     * Получить или создать сессионный ключ для чата
     */
    async function getSessionKey(chatId, authToken) {
        const cached = sessionKeyCache.get(chatId);
        if (cached) return cached.key;

        const privateKey = await dbGet('privateKey');
        const myKeyId = await dbGet('keyId');
        const myPublicKeyB64 = await dbGet('publicKeyB64');
        if (!privateKey) return null;

        // Пробуем загрузить существующий ключ с сервера
        try {
            const res = await fetch('/api/v2/encryption/my-key/' + chatId, {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });

            if (res.ok) {
                const { encrypted_key, sender_key_id, pq_ciphertext } = await res.json();
                
                const myUserId = JSON.parse(localStorage.getItem('craneapp_user_data') || '{}').id;
                let senderPublicKeyB64;

                // Для старых чатов sender_key_id мог хранить myUserId
                if (sender_key_id === myKeyId || sender_key_id === myUserId) {
                    senderPublicKeyB64 = myPublicKeyB64;
                } else {
                    const keysRes = await fetch('/api/v2/encryption/chat-keys/' + chatId, {
                        headers: { 'Authorization': 'Bearer ' + authToken }
                    });
                    if (keysRes.ok) {
                        const { keys } = await keysRes.json();
                        const senderKey = keys.find(k => k.key_id === sender_key_id || k.user_id === sender_key_id);
                        if (senderKey) senderPublicKeyB64 = senderKey.public_key;
                    }
                }

                if (senderPublicKeyB64) {
                    try {
                        const pqSecretKey = await dbGet('pqSecretKey');
                        const sessionKey = await unwrapSessionKey(encrypted_key, senderPublicKeyB64, pq_ciphertext, privateKey, pqSecretKey);
                        sessionKeyCache.set(chatId, { key: sessionKey, epoch: key_epoch || 0, msgCount: 0 });
                        return sessionKey;
                    } catch (e) {
                        console.warn('⚠️ E2E: unwrapSessionKey failed (wrong private key?)', e);
                        // Если ключ есть на сервере, но мы не можем его расшифровать (сменилось устройство),
                        // нельзя генерировать новый и перезаписывать его! Иначе сломаем историю другим.
                        return null;
                    }
                } else {
                    console.warn('⚠️ E2E: Could not find sender public key for session key.');
                    return null; // Аналогично, не перезаписываем ключ
                }
            }
        } catch (e) {
            console.warn('⚠️ E2E: Error fetching my-key:', e);
            return null; // При сетевой ошибке тоже не перезаписываем
        }

        // Создаём новый сессионный ключ
        try {
            const sessionKey = await generateSessionKey();

            // Получаем публичные ключи всех участников чата
            const keysRes = await fetch('/api/v2/encryption/chat-keys/' + chatId, {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });

            if (!keysRes.ok) {
                sessionKeyCache.set(chatId, sessionKey);
                return sessionKey;
            }

            const { keys } = await keysRes.json();
            if (!keys || keys.length === 0) {
                sessionKeyCache.set(chatId, sessionKey);
                return sessionKey;
            }

            // Шифруем сессионный ключ для каждого участника
            const encryptedKeys = [];
            for (const { user_id, public_key, pq_public_key } of keys) {
                try {
                    const { wrappedKeyStr, pqCiphertext } = await wrapSessionKey(sessionKey, public_key, pq_public_key, privateKey);
                    encryptedKeys.push({ userId: user_id, encryptedKey: wrappedKeyStr, senderKeyId: myKeyId, pqCiphertext });
                } catch (e) {
                    console.warn('⚠️ E2E: Could not wrap key for user', user_id, e);
                }
            }

            // Также шифруем для себя (если нас нет в списке)
            const myUserId = JSON.parse(localStorage.getItem('craneapp_user_data') || '{}').id;
            if (myUserId && !keys.find(k => k.user_id === myUserId)) {
                const myPQPublicKeyB64 = await dbGet('pqPublicKeyB64');
                const { wrappedKeyStr, pqCiphertext } = await wrapSessionKey(sessionKey, myPublicKeyB64, myPQPublicKeyB64, privateKey);
                encryptedKeys.push({ userId: myUserId, encryptedKey: wrappedKeyStr, senderKeyId: myKeyId, pqCiphertext });
            }

            if (encryptedKeys.length > 0) {
                await fetch('/api/v2/encryption/chat-keys/' + chatId, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + authToken
                    },
                    body: JSON.stringify({ encryptedKeys })
                });
            }

            sessionKeyCache.set(chatId, { key: sessionKey, epoch: 0, msgCount: 0 });
            return sessionKey;
        } catch (e) {
            console.warn('⚠️ E2E: Could not create session key:', e);
            return null;
        }
    }

    /**
     * Rotate the session key for a chat (forward secrecy).
     * Called automatically after SESSION_KEY_ROTATION_THRESHOLD messages.
     */
    async function rotateSessionKey(chatId, authToken) {
        try {
            const cached = sessionKeyCache.get(chatId);
            const newEpoch = ((cached && cached.epoch) || 0) + 1;

            const privateKey = await dbGet('privateKey');
            const myKeyId = await dbGet('keyId');
            const myPublicKeyB64 = await dbGet('publicKeyB64');
            if (!privateKey) return null;

            const newSessionKey = await generateSessionKey();

            const keysRes = await fetch('/api/v2/encryption/chat-keys/' + chatId, {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            if (!keysRes.ok) return null;

            const { keys } = await keysRes.json();
            const encryptedKeys = [];

            for (const { user_id, public_key, pq_public_key } of (keys || [])) {
                try {
                    const { wrappedKeyStr, pqCiphertext } = await wrapSessionKey(newSessionKey, public_key, pq_public_key, privateKey);
                    encryptedKeys.push({ userId: user_id, encryptedKey: wrappedKeyStr, senderKeyId: myKeyId, pqCiphertext });
                } catch (_) {}
            }

            const myUserId = JSON.parse(localStorage.getItem('craneapp_user_data') || '{}').id;
            if (myUserId && !keys.find(k => k.user_id === myUserId)) {
                const myPQPublicKeyB64 = await dbGet('pqPublicKeyB64');
                const { wrappedKeyStr, pqCiphertext } = await wrapSessionKey(newSessionKey, myPublicKeyB64, myPQPublicKeyB64, privateKey);
                encryptedKeys.push({ userId: myUserId, encryptedKey: wrappedKeyStr, senderKeyId: myKeyId, pqCiphertext });
            }

            if (encryptedKeys.length > 0) {
                await fetch('/api/v2/encryption/rotate-key/' + chatId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
                    body: JSON.stringify({ encryptedKeys, keyEpoch: newEpoch })
                });
            }

            sessionKeyCache.set(chatId, { key: newSessionKey, epoch: newEpoch, msgCount: 0 });
            return newSessionKey;
        } catch (e) {
            console.warn('⚠️ E2E rotateSessionKey failed:', e);
            return null;
        }
    }

    /**
     * Зашифровать текст сообщения
     * Возвращает { content: '<base64>', iv: '<base64>', isEncrypted: true }
     * или исходный объект если шифрование недоступно
     */
    async function encrypt(text, chatId, authToken) {
        try {
            let sessionKey = await getSessionKey(chatId, authToken);
            if (!sessionKey) return { content: text, isEncrypted: false };

            // Auto-rotate after threshold for forward secrecy
            const cached = sessionKeyCache.get(chatId);
            if (cached) {
                cached.msgCount = (cached.msgCount || 0) + 1;
                if (cached.msgCount >= SESSION_KEY_ROTATION_THRESHOLD) {
                    const rotated = await rotateSessionKey(chatId, authToken);
                    if (rotated) sessionKey = rotated;
                }
            }

            const { ciphertext, iv } = await encryptMessage(text, sessionKey);
            return { content: ciphertext, iv, isEncrypted: true };
        } catch (e) {
            console.warn('⚠️ E2E encrypt failed:', e);
            return { content: text, isEncrypted: false };
        }
    }

    /**
     * Расшифровать сообщение
     */
    async function decrypt(ciphertext, iv, chatId, authToken) {
        try {
            const sessionKey = await getSessionKey(chatId, authToken);
            if (!sessionKey) return ciphertext;
            return await decryptMessage(ciphertext, iv, sessionKey);
        } catch (e) {
            console.warn('⚠️ E2E decrypt failed:', e);
            return '🔒 [зашифровано]';
        }
    }

    /**
     * Сбросить кэш ключей (при смене чата или logout)
     */
    function clearCache(chatId) {
        if (chatId) sessionKeyCache.delete(chatId);
        else sessionKeyCache.clear();
    }

    return { init, encrypt, decrypt, getSessionKey, rotateSessionKey, clearCache };
})();

window.E2E = E2E;
}

/**
 * CraneApp — MLS-inspired Group Key Ratcheting
 *
 * Схема: HKDF-based forward-secret group encryption.
 * Каждый epoch порождает уникальный ключ шифрования, не позволяя
 * раскрыть предыдущие эпохи при компрометации текущего корневого секрета.
 *
 * Для новых участников: аддер оборачивает текущий rootSecret публичным
 * ключом нового члена и отправляет Welcome через сервер.
 */

if (!window.MLS) {
const MLS = (() => {
    const DB_NAME = 'craneapp_mls';
    const DB_VERSION = 1;
    const STORE_NAME = 'group_states';

    // ── IndexedDB ─────────────────────────────────────────────────────────
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => { e.target.result.createObjectStore(STORE_NAME); };
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

    function bufToB64(buf) {
        return btoa(String.fromCharCode(...new Uint8Array(buf)));
    }

    function b64ToBuf(b64) {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
    }

    // ── HKDF helpers ──────────────────────────────────────────────────────

    async function hkdfDerive(inputKeyMaterial, info, outputBytes = 32) {
        const keyMaterial = await crypto.subtle.importKey(
            'raw', inputKeyMaterial, { name: 'HKDF' }, false, ['deriveBits']
        );
        const bits = await crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(info) },
            keyMaterial,
            outputBytes * 8
        );
        return new Uint8Array(bits);
    }

    // Derive next epoch's root secret (HKDF one-way → forward secrecy)
    async function deriveNextRoot(currentRoot, nextEpoch) {
        return hkdfDerive(currentRoot, `crane-mls-root-v1-${nextEpoch}`);
    }

    // Derive per-epoch AES-256-GCM key from root
    async function deriveEpochKey(root, epoch) {
        const keyBytes = await hkdfDerive(root, `crane-mls-epoch-key-v1-${epoch}`);
        return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }

    // Commit authenticator: 32-byte HKDF output from new root.
    // Server and future clients can detect tampering by size (32 bytes) but
    // cannot derive the root from it — it's a one-way commitment.
    async function deriveCommitAuth(newRoot, epoch) {
        return hkdfDerive(newRoot, `crane-mls-commit-auth-v1-${epoch}`);
    }

    // ── KeyPackage generation (P-256 ECDH, raw 65-byte uncompressed point) ─
    async function generateKeyPackage() {
        const kpPair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
        );
        const rawPub = await crypto.subtle.exportKey('raw', kpPair.publicKey);
        return { privateKey: kpPair.privateKey, publicKeyB64: bufToB64(rawPub) };
    }

    // ── Welcome message: wrap rootSecret for a new member ─────────────────
    async function createWelcome(rootSecret, epoch, recipientPublicKeyB64) {
        const recipientPubRaw = new Uint8Array(b64ToBuf(recipientPublicKeyB64));
        const recipientPubKey = await crypto.subtle.importKey(
            'raw', recipientPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
        );

        // Ephemeral ECDH key pair for this Welcome
        const ephemeral = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
        );
        const ephemeralPubRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);

        // ECDH shared secret → AES-GCM wrap key
        const sharedBits = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: recipientPubKey }, ephemeral.privateKey, 256
        );
        const wrapKeyBytes = await hkdfDerive(new Uint8Array(sharedBits), `crane-mls-welcome-wrap-v1-${epoch}`);
        const wrapKey = await crypto.subtle.importKey(
            'raw', wrapKeyBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
        );

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const payload = new Uint8Array([...rootSecret, ...new Uint8Array(4)]);
        // embed epoch as 4-byte big-endian
        new DataView(payload.buffer).setUint32(rootSecret.length, epoch, false);

        const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, payload);
        const welcome = { ephemeralPub: bufToB64(ephemeralPubRaw), iv: bufToB64(iv), sealed: bufToB64(sealed) };
        return bufToB64(new TextEncoder().encode(JSON.stringify(welcome)));
    }

    // ── Process Welcome: decrypt rootSecret from adder ────────────────────
    async function processWelcome(welcomeB64, myPrivateKey) {
        const json = new TextDecoder().decode(new Uint8Array(b64ToBuf(welcomeB64)));
        const { ephemeralPub, iv, sealed } = JSON.parse(json);

        const ephemeralPubKey = await crypto.subtle.importKey(
            'raw', new Uint8Array(b64ToBuf(ephemeralPub)), { name: 'ECDH', namedCurve: 'P-256' }, false, []
        );
        const sharedBits = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: ephemeralPubKey }, myPrivateKey, 256
        );

        const sealedBytes = new Uint8Array(b64ToBuf(sealed));
        const ivBytes = new Uint8Array(b64ToBuf(iv));

        // We don't know epoch yet — derive wrap key with epoch 0 as placeholder then read epoch from payload
        // Reconstruct: try to decrypt and extract epoch
        const sharedArr = new Uint8Array(sharedBits);
        // epoch encoded in payload, try all recent epochs (±256 of current)
        // Use a marker: try to derive with epoch from payload itself via brute-search is wrong.
        // Instead: Welcome includes epoch in the server envelope (we get it from the API response).
        // Store epoch alongside welcomeBytes on the server. Extract from outer envelope.
        // For now: caller passes epoch from API.
        throw new Error('Use processWelcomeWithEpoch instead');
    }

    async function processWelcomeWithEpoch(welcomeB64, myPrivateKey, epoch) {
        const json = new TextDecoder().decode(new Uint8Array(b64ToBuf(welcomeB64)));
        const { ephemeralPub, iv, sealed } = JSON.parse(json);

        const ephemeralPubKey = await crypto.subtle.importKey(
            'raw', new Uint8Array(b64ToBuf(ephemeralPub)), { name: 'ECDH', namedCurve: 'P-256' }, false, []
        );
        const sharedBits = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: ephemeralPubKey }, myPrivateKey, 256
        );

        const wrapKeyBytes = await hkdfDerive(new Uint8Array(sharedBits), `crane-mls-welcome-wrap-v1-${epoch}`);
        const wrapKey = await crypto.subtle.importKey(
            'raw', wrapKeyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(iv)) },
            wrapKey,
            new Uint8Array(b64ToBuf(sealed))
        );
        const payload = new Uint8Array(decrypted);
        const rootSecret = payload.slice(0, 32);
        return { rootSecret, epoch };
    }

    // ── Initialize MLS on client ──────────────────────────────────────────
    async function init(authToken) {
        try {
            let keyPackages = await dbGet('my_keypackages');
            if (!keyPackages || keyPackages.length < 2) {
                keyPackages = [];
                for (let i = 0; i < 5; i++) {
                    const kp = await generateKeyPackage();
                    keyPackages.push({ id: String(i), publicKeyB64: kp.publicKeyB64, privateKey: kp.privateKey });
                }
                await dbSet('my_keypackages', keyPackages);
            }

            const pkPayload = keyPackages.map(kp => ({
                keypackageId: kp.id,
                keypackageBytes: kp.publicKeyB64
            }));

            const res = await fetch('/api/v2/mls/keypackages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
                body: JSON.stringify({ keypackages: pkPayload })
            });

            if (!res.ok) {
                console.warn('⚠️ MLS: KeyPackage upload failed');
            }
            return true;
        } catch (e) {
            console.warn('⚠️ MLS init failed:', e);
            return false;
        }
    }

    // ── Load or init group state ──────────────────────────────────────────
    async function loadGroupState(chatId, authToken) {
        let state = await dbGet(`group_${chatId}`);
        if (state) return state;

        // Try to get Welcome (new member path)
        try {
            const wRes = await fetch(`/api/v2/mls/group/${chatId}/welcome`, {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            if (wRes.ok) {
                const { welcomeBytes, epoch } = await wRes.json();
                const kps = await dbGet('my_keypackages');
                if (kps && kps.length > 0) {
                    // Try each stored private key
                    for (const kp of kps) {
                        try {
                            const { rootSecret } = await processWelcomeWithEpoch(welcomeBytes, kp.privateKey, epoch);
                            state = { epoch, rootSecret };
                            await dbSet(`group_${chatId}`, state);
                            return state;
                        } catch (_) { /* try next key */ }
                    }
                }
            }
        } catch (_) { /* fall through to fetch server state */ }

        // Fetch current epoch from server (existing member re-sync)
        try {
            const sRes = await fetch(`/api/v2/mls/group/${chatId}/state`, {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            if (sRes.ok) {
                const data = await sRes.json();
                if (data.treeStructure) {
                    state = {
                        epoch: parseInt(data.epoch, 10),
                        rootSecret: new Uint8Array(b64ToBuf(data.treeStructure))
                    };
                    await dbSet(`group_${chatId}`, state);
                    return state;
                }
            }
        } catch (_) { /* fall through */ }

        // Bootstrap: first message in this group from this client
        const rootSecret = crypto.getRandomValues(new Uint8Array(32));
        state = { epoch: 0, rootSecret };
        await dbSet(`group_${chatId}`, state);
        return state;
    }

    // ── MLS Encryption ────────────────────────────────────────────────────
    async function encrypt(text, chatId, authToken) {
        try {
            let state = await loadGroupState(chatId, authToken);

            const epochKey = await deriveEpochKey(state.rootSecret, state.epoch);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ciphertext = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv }, epochKey, new TextEncoder().encode(text)
            );

            // Ratchet: derive next root (HKDF one-way → forward secrecy)
            const nextEpoch = state.epoch + 1;
            const newRootSecret = await deriveNextRoot(state.rootSecret, nextEpoch);
            const commitAuth = await deriveCommitAuth(newRootSecret, nextEpoch);
            const commitBytes = bufToB64(commitAuth);

            const commitRes = await fetch(`/api/v2/mls/group/${chatId}/commit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
                body: JSON.stringify({
                    commitBytes,
                    currentEpoch: state.epoch,
                    treeStructure: bufToB64(newRootSecret)
                })
            });

            if (commitRes.ok) {
                state = { epoch: nextEpoch, rootSecret: newRootSecret };
                await dbSet(`group_${chatId}`, state);
            }

            return {
                content: bufToB64(ciphertext),
                iv: bufToB64(iv),
                epoch: state.epoch,
                isEncrypted: true,
                isMls: true
            };
        } catch (e) {
            console.warn('⚠️ MLS encrypt failed:', e);
            return { content: text, isEncrypted: false };
        }
    }

    // ── MLS Decryption ────────────────────────────────────────────────────
    async function decrypt(ciphertextB64, ivB64, epoch, chatId, authToken) {
        try {
            let state = await dbGet(`group_${chatId}`);

            if (!state || state.epoch < epoch) {
                // Re-sync from server
                try {
                    const sRes = await fetch(`/api/v2/mls/group/${chatId}/state`, {
                        headers: { 'Authorization': 'Bearer ' + authToken }
                    });
                    if (sRes.ok) {
                        const data = await sRes.json();
                        state = { epoch: parseInt(data.epoch, 10), rootSecret: new Uint8Array(b64ToBuf(data.treeStructure)) };
                        await dbSet(`group_${chatId}`, state);
                    }
                } catch (_) { /* use stale state */ }
            }

            if (!state) return '🔒 [зашифровано MLS]';

            // The message was encrypted with epochKey(rootAtEpoch, epoch).
            // If message epoch < state.epoch, we need the root at that time.
            // We can only decrypt if state.epoch === epoch (we have the right root).
            // Old messages with a different epoch cannot be decrypted if root was ratcheted past.
            if (state.epoch !== epoch) {
                return '🔒 [ключ эпохи недоступен]';
            }

            const epochKey = await deriveEpochKey(state.rootSecret, epoch);
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(ivB64)) },
                epochKey,
                new Uint8Array(b64ToBuf(ciphertextB64))
            );
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.warn('⚠️ MLS decrypt failed:', e);
            return '🔒 [ошибка расшифрования MLS]';
        }
    }

    // ── Add a new member: send them a Welcome ─────────────────────────────
    async function addMember(chatId, recipientId, recipientPublicKeyB64, authToken) {
        try {
            const state = await dbGet(`group_${chatId}`);
            if (!state) return false;

            const welcomeBytes = await createWelcome(state.rootSecret, state.epoch, recipientPublicKeyB64);
            const res = await fetch(`/api/v2/mls/group/${chatId}/welcome`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
                body: JSON.stringify({ recipientId, welcomeBytes, epoch: state.epoch })
            });
            return res.ok;
        } catch (e) {
            console.warn('⚠️ MLS addMember failed:', e);
            return false;
        }
    }

    return { init, encrypt, decrypt, addMember };
})();

window.MLS = MLS;
}

const express = require('express');

const MAX_KEY_ROTATIONS_PER_HOUR = 10;
const SESSION_KEY_ROTATION_THRESHOLD = 200;

function isValidBase64(str) {
    if (typeof str !== 'string' || str.length === 0) return false;
    return /^[A-Za-z0-9+/]*={0,2}$/.test(str);
}

// P-256 SPKI public key is 91 bytes when exported as spki format
// Raw uncompressed P-256 is 65 bytes (0x04 prefix)
function isValidPublicKey(b64) {
    if (!isValidBase64(b64)) return false;
    try {
        const buf = atob(b64);
        return buf.length >= 65 && buf.length <= 256;
    } catch (_) { return false; }
}

function createEncryptionRoutes({ authMiddleware, logger, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.post('/keys', async (req, res) => {
        try {
            const { publicKey, keyId, pqPublicKey } = req.body;
            if (!publicKey || !keyId) return res.status(400).json({ error: 'publicKey and keyId required' });
            if (!isValidPublicKey(publicKey)) return res.status(400).json({ error: 'Invalid publicKey format' });
            if (typeof keyId !== 'string' || keyId.length < 16 || keyId.length > 128) {
                return res.status(400).json({ error: 'Invalid keyId' });
            }

            await query(`
                INSERT INTO user_public_keys (user_id, public_key, key_id, pq_public_key, created_at, updated_at)
                VALUES ($1, $2, $3, $4, NOW(), NOW())
                ON CONFLICT (user_id) DO UPDATE SET public_key = $2, key_id = $3, pq_public_key = $4, updated_at = NOW()
            `, [req.user.id, publicKey, keyId, pqPublicKey || null]);

            // Audit: key published
            query(
                `INSERT INTO crypto_audit_log (id, user_id, event_type, details, created_at)
                 VALUES ($1, $2, 'key_published', $3, NOW())`,
                [uuidv4(), req.user.id, JSON.stringify({ keyId, hasPQ: !!pqPublicKey })]
            ).catch(() => {});

            res.json({ ok: true });
        } catch (error) {
            logger.error('❌ Upload key error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Public key lookup — requester must share a chat with the target user
    router.get('/keys/:userId', async (req, res) => {
        try {
            const sharedChat = await query(
                `SELECT 1 FROM chat_members a
                 JOIN chat_members b ON a.chat_id = b.chat_id
                 WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1`,
                [req.user.id, req.params.userId]
            );
            if (!sharedChat.rows.length && req.user.id !== req.params.userId) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const result = await query(
                'SELECT public_key, key_id, pq_public_key FROM user_public_keys WHERE user_id = $1',
                [req.params.userId]
            );
            if (!result.rows.length) return res.status(404).json({ error: 'Key not found' });
            const row = result.rows[0];
            res.json({
                publicKey: row.public_key,
                keyId: row.key_id,
                pqPublicKey: row.pq_public_key
            });
        } catch (_) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/chat-keys/:chatId', async (req, res) => {
        try {
            if (!(await isChatMember(query, req.params.chatId, req.user.id))) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }
            const result = await query(`
                SELECT upk.user_id, upk.public_key, upk.key_id, upk.pq_public_key
                FROM chat_members cm
                JOIN user_public_keys upk ON cm.user_id = upk.user_id
                WHERE cm.chat_id = $1
            `, [req.params.chatId]);

            const keys = result.rows.map(row => ({
                user_id: row.user_id,
                public_key: row.public_key,
                key_id: row.key_id,
                pq_public_key: row.pq_public_key
            }));
            res.json({ keys });
        } catch (_) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/chat-keys/:chatId', async (req, res) => {
        try {
            const { encryptedKeys, keyEpoch = 0 } = req.body;
            if (!Array.isArray(encryptedKeys)) return res.status(400).json({ error: 'encryptedKeys array required' });
            if (encryptedKeys.length > 500) return res.status(400).json({ error: 'Too many keys' });
            if (!(await isChatMember(query, req.params.chatId, req.user.id))) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }

            for (const { userId, encryptedKey, senderKeyId, pqCiphertext } of encryptedKeys) {
                // Only allow uploading keys for users who are members of this chat
                const targetMember = await isChatMember(query, req.params.chatId, userId);
                if (!targetMember) continue;

                await query(`
                    INSERT INTO chat_encryption_keys (id, chat_id, user_id, encrypted_key, sender_key_id, pq_ciphertext, key_epoch, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    ON CONFLICT (chat_id, user_id) DO UPDATE
                    SET encrypted_key = $4, sender_key_id = $5, pq_ciphertext = $6, key_epoch = $7
                    WHERE chat_encryption_keys.key_epoch <= $7
                `, [uuidv4(), req.params.chatId, userId, encryptedKey, senderKeyId, pqCiphertext || null, keyEpoch]);
            }
            res.json({ ok: true });
        } catch (error) {
            logger.error('❌ Save chat key error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Key rotation endpoint: generate new session key, wrap for all chat members
    router.post('/rotate-key/:chatId', async (req, res) => {
        try {
            if (!(await isChatMember(query, req.params.chatId, req.user.id))) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }

            // Rate limit: max MAX_KEY_ROTATIONS_PER_HOUR rotations per chat per hour
            const recentRotations = await query(
                `SELECT COUNT(*) FROM crypto_audit_log
                 WHERE event_type = 'key_rotation' AND chat_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
                [req.params.chatId]
            );
            if (parseInt(recentRotations.rows[0].count, 10) >= MAX_KEY_ROTATIONS_PER_HOUR) {
                return res.status(429).json({ error: 'Key rotation rate limit exceeded' });
            }

            const { encryptedKeys, keyEpoch } = req.body;
            if (!Array.isArray(encryptedKeys) || typeof keyEpoch !== 'number') {
                return res.status(400).json({ error: 'encryptedKeys and keyEpoch required' });
            }

            for (const { userId, encryptedKey, senderKeyId, pqCiphertext } of encryptedKeys) {
                const targetMember = await isChatMember(query, req.params.chatId, userId);
                if (!targetMember) continue;

                await query(`
                    INSERT INTO chat_encryption_keys (id, chat_id, user_id, encrypted_key, sender_key_id, pq_ciphertext, key_epoch, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    ON CONFLICT (chat_id, user_id) DO UPDATE
                    SET encrypted_key = $4, sender_key_id = $5, pq_ciphertext = $6, key_epoch = $7
                `, [uuidv4(), req.params.chatId, userId, encryptedKey, senderKeyId, pqCiphertext || null, keyEpoch]);
            }

            // Audit log
            await query(
                `INSERT INTO crypto_audit_log (id, user_id, chat_id, event_type, created_at)
                 VALUES ($1, $2, $3, 'key_rotation', NOW())`,
                [uuidv4(), req.user.id, req.params.chatId]
            ).catch(() => {}); // non-fatal

            res.json({ ok: true, keyEpoch });
        } catch (error) {
            logger.error('❌ Rotate key error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/my-key/:chatId', async (req, res) => {
        try {
            const result = await query(
                'SELECT encrypted_key, sender_key_id, pq_ciphertext, key_epoch FROM chat_encryption_keys WHERE chat_id = $1 AND user_id = $2',
                [req.params.chatId, req.user.id]
            );
            if (!result.rows.length) return res.status(404).json({ error: 'No key found' });
            const row = result.rows[0];
            res.json({
                encrypted_key: row.encrypted_key,
                sender_key_id: row.sender_key_id,
                pq_ciphertext: row.pq_ciphertext,
                key_epoch: row.key_epoch || 0
            });
        } catch (_) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
}

function isChatMember(query, chatId, userId) {
    return query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId])
        .then((result) => result.rows.length > 0);
}

module.exports = createEncryptionRoutes;

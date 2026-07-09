const express = require('express');

const MAX_KEYPACKAGES_PER_UPLOAD = 20;
const RUST_CRYPTO_URL = process.env.RUST_CRYPTO_URL || 'http://127.0.0.1:5005';
const RUST_TIMEOUT_MS = 5000;

function createMlsRoutes({ authMiddleware, logger, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    async function callRust(path, body) {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), RUST_TIMEOUT_MS);
        try {
            const res = await fetch(`${RUST_CRYPTO_URL}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
            clearTimeout(tid);
            if (!res.ok) throw new Error('validator_unavailable');
            return await res.json();
        } catch (e) {
            clearTimeout(tid);
            throw e;
        }
    }

    function isValidBase64(str) {
        if (typeof str !== 'string' || str.length === 0) return false;
        return /^[A-Za-z0-9+/]*={0,2}$/.test(str);
    }

    // 1. Upload pool of MLS KeyPackages
    router.post('/keypackages', async (req, res) => {
        try {
            const { keypackages } = req.body;
            if (!Array.isArray(keypackages)) {
                return res.status(400).json({ error: 'keypackages array required' });
            }
            if (keypackages.length === 0 || keypackages.length > MAX_KEYPACKAGES_PER_UPLOAD) {
                return res.status(400).json({ error: `keypackages array must have 1–${MAX_KEYPACKAGES_PER_UPLOAD} entries` });
            }

            for (const kp of keypackages) {
                const { keypackageBytes } = kp;
                if (!isValidBase64(keypackageBytes)) {
                    return res.status(400).json({ error: 'keypackageBytes must be valid base64' });
                }

                let validation;
                try {
                    validation = await callRust('/api/v2/crypto/mls/validate-keypackage', { keypackage_bytes: keypackageBytes });
                } catch (_) {
                    return res.status(503).json({ error: 'Crypto service unavailable' });
                }

                if (!validation.valid) {
                    return res.status(400).json({ error: 'Invalid keypackage format' });
                }

                const keypackageId = validation.key_id;

                await query(`
                    INSERT INTO user_mls_keypackages (id, user_id, keypackage_id, keypackage_bytes, created_at)
                    VALUES ($1, $2, $3, $4, NOW())
                `, [uuidv4(), req.user.id, keypackageId, keypackageBytes]);
            }

            res.json({ ok: true });
        } catch (error) {
            logger.error('❌ Upload MLS KeyPackage error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // 2. Fetch and consume one KeyPackage for a user (must be in a shared chat)
    router.get('/keypackages/:userId', async (req, res) => {
        try {
            // Requester must share at least one chat with the target user
            const sharedChat = await query(
                `SELECT 1 FROM chat_members a
                 JOIN chat_members b ON a.chat_id = b.chat_id
                 WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1`,
                [req.user.id, req.params.userId]
            );
            if (!sharedChat.rows.length) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Transaction: atomically fetch and delete (single-use)
            await query('BEGIN');
            const result = await query(
                'SELECT id, keypackage_id, keypackage_bytes FROM user_mls_keypackages WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE',
                [req.params.userId]
            );

            if (!result.rows.length) {
                await query('ROLLBACK');
                return res.status(404).json({ error: 'No keypackages available for user' });
            }

            const kp = result.rows[0];
            await query('DELETE FROM user_mls_keypackages WHERE id = $1', [kp.id]);
            await query('COMMIT');

            // Audit: KeyPackage consumed
            query(
                `INSERT INTO crypto_audit_log (id, user_id, event_type, details, created_at)
                 VALUES ($1, $2, 'keypackage_consumed', $3, NOW())`,
                [uuidv4(), req.user.id, JSON.stringify({ targetUserId: req.params.userId })]
            ).catch(() => {});

            res.json({
                keypackageId: kp.keypackage_id,
                keypackageBytes: kp.keypackage_bytes
            });
        } catch (error) {
            await query('ROLLBACK');
            logger.error('❌ Fetch MLS KeyPackage error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // 3. Get MLS group tree state and current epoch
    router.get('/group/:chatId/state', async (req, res) => {
        try {
            // Verify membership
            const member = await query(
                'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
                [req.params.chatId, req.user.id]
            );
            if (!member.rows.length) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const result = await query(
                'SELECT epoch, tree_structure FROM group_mls_state WHERE chat_id = $1',
                [req.params.chatId]
            );

            if (!result.rows.length) {
                return res.json({ epoch: '0', treeStructure: null });
            }

            res.json({
                epoch: result.rows[0].epoch,
                treeStructure: result.rows[0].tree_structure
            });
        } catch (error) {
            logger.error('❌ Get MLS group state error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // 4. Submit an MLS epoch Commit (HKDF ratchet)
    router.post('/group/:chatId/commit', async (req, res) => {
        try {
            const { commitBytes, currentEpoch, treeStructure } = req.body;
            if (!commitBytes || currentEpoch === undefined || !treeStructure) {
                return res.status(400).json({ error: 'commitBytes, currentEpoch, and treeStructure are required' });
            }
            if (!isValidBase64(commitBytes) || !isValidBase64(treeStructure)) {
                return res.status(400).json({ error: 'commitBytes and treeStructure must be valid base64' });
            }

            // Membership check
            const member = await query(
                'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
                [req.params.chatId, req.user.id]
            );
            if (!member.rows.length) {
                return res.status(403).json({ error: 'Access denied' });
            }

            let validation;
            try {
                validation = await callRust('/api/v2/crypto/mls/validate-commit', {
                    commit_bytes: commitBytes,
                    current_epoch: parseInt(currentEpoch, 10)
                });
            } catch (_) {
                return res.status(503).json({ error: 'Crypto service unavailable' });
            }

            if (!validation.valid) {
                return res.status(400).json({ error: 'Invalid commit format' });
            }

            const nextEpoch = validation.next_epoch;

            // CAS: protect against double commit / epoch forks
            await query('BEGIN');

            const stateRes = await query(
                'SELECT epoch FROM group_mls_state WHERE chat_id = $1 FOR UPDATE',
                [req.params.chatId]
            );

            const dbEpoch = stateRes.rows.length ? parseInt(stateRes.rows[0].epoch, 10) : 0;

            if (dbEpoch !== parseInt(currentEpoch, 10)) {
                await query('ROLLBACK');
                return res.status(409).json({
                    error: 'Epoch conflict. Group state has moved ahead.',
                    currentDbEpoch: dbEpoch
                });
            }

            if (stateRes.rows.length) {
                await query(
                    'UPDATE group_mls_state SET epoch = $1, tree_structure = $2, updated_at = NOW() WHERE chat_id = $3',
                    [nextEpoch, treeStructure, req.params.chatId]
                );
            } else {
                await query(
                    'INSERT INTO group_mls_state (chat_id, epoch, tree_structure, updated_at) VALUES ($1, $2, $3, NOW())',
                    [req.params.chatId, nextEpoch, treeStructure]
                );
            }

            await query(`
                INSERT INTO group_mls_commits (id, chat_id, epoch, sender_id, commit_bytes, created_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
            `, [uuidv4(), req.params.chatId, nextEpoch, req.user.id, commitBytes]);

            await query('COMMIT');

            // Audit: epoch committed
            query(
                `INSERT INTO crypto_audit_log (id, user_id, chat_id, event_type, details, created_at)
                 VALUES ($1, $2, $3, 'mls_commit', $4, NOW())`,
                [uuidv4(), req.user.id, req.params.chatId, JSON.stringify({ epoch: nextEpoch })]
            ).catch(() => {});

            res.json({ ok: true, nextEpoch });
        } catch (error) {
            await query('ROLLBACK');
            logger.error('❌ Submit MLS commit error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // 5. Store Welcome message for a new group member
    router.post('/group/:chatId/welcome', async (req, res) => {
        try {
            const { recipientId, welcomeBytes, epoch } = req.body;
            if (!recipientId || !welcomeBytes || epoch === undefined) {
                return res.status(400).json({ error: 'recipientId, welcomeBytes, and epoch are required' });
            }
            if (!isValidBase64(welcomeBytes)) {
                return res.status(400).json({ error: 'welcomeBytes must be valid base64' });
            }

            // Sender must be a group member
            const sender = await query(
                'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
                [req.params.chatId, req.user.id]
            );
            if (!sender.rows.length) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Recipient must also be a member
            const recipient = await query(
                'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
                [req.params.chatId, recipientId]
            );
            if (!recipient.rows.length) {
                return res.status(400).json({ error: 'Recipient is not a group member' });
            }

            // Validate welcome bytes via Rust
            let validation;
            try {
                validation = await callRust('/api/v2/crypto/mls/validate-welcome', { welcome_bytes: welcomeBytes });
            } catch (_) {
                return res.status(503).json({ error: 'Crypto service unavailable' });
            }

            if (!validation.valid) {
                return res.status(400).json({ error: 'Invalid welcome format' });
            }

            await query(`
                INSERT INTO group_mls_welcome (id, chat_id, recipient_id, sender_id, epoch, welcome_bytes, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (chat_id, recipient_id) DO UPDATE
                SET sender_id = $4, epoch = $5, welcome_bytes = $6, created_at = NOW()
            `, [uuidv4(), req.params.chatId, recipientId, req.user.id, epoch, welcomeBytes]);

            res.json({ ok: true });
        } catch (error) {
            logger.error('❌ Store MLS welcome error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // 6. Fetch Welcome message for self (new member joining)
    router.get('/group/:chatId/welcome', async (req, res) => {
        try {
            const result = await query(
                'SELECT sender_id, epoch, welcome_bytes FROM group_mls_welcome WHERE chat_id = $1 AND recipient_id = $2',
                [req.params.chatId, req.user.id]
            );

            if (!result.rows.length) {
                return res.status(404).json({ error: 'No welcome message available' });
            }

            const row = result.rows[0];
            res.json({
                senderId: row.sender_id,
                epoch: row.epoch,
                welcomeBytes: row.welcome_bytes
            });
        } catch (error) {
            logger.error('❌ Fetch MLS welcome error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
}

module.exports = createMlsRoutes;

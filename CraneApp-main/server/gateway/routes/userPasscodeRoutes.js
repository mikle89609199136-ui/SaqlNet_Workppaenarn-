const express = require('express');

function createUserPasscodeRoutes({ authMiddleware, bcrypt, query }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/passcode', async (req, res) => {
        try {
            const result = await query(
                'SELECT passcode_enabled, passcode_timeout FROM user_settings WHERE user_id = $1',
                [req.user.id]
            );
            const row = result.rows[0] || {};
            res.json({ enabled: row.passcode_enabled || false, timeout: row.passcode_timeout || 60 });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/passcode/set', async (req, res) => {
        try {
            const { passcode } = req.body;
            if (!passcode || passcode.length < 4) {
                return res.status(400).json({ error: 'Passcode must be at least 4 digits' });
            }

            const hash = await bcrypt.hash(passcode, 10);
            await query(
                `INSERT INTO user_settings (user_id, passcode_hash, passcode_enabled, updated_at)
                 VALUES ($1, $2, TRUE, NOW())
                 ON CONFLICT (user_id)
                 DO UPDATE SET passcode_hash = $2, passcode_enabled = TRUE, updated_at = NOW()`,
                [req.user.id, hash]
            );
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/passcode/verify', async (req, res) => {
        try {
            const passcodeHash = await getPasscodeHash(query, req.user.id);
            if (!passcodeHash) return res.status(400).json({ error: req.t('noPasscodeSet') });

            const match = await bcrypt.compare(req.body.passcode, passcodeHash);
            if (!match) return res.status(401).json({ error: 'Wrong passcode' });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/passcode/disable', async (req, res) => {
        try {
            const passcodeHash = await getPasscodeHash(query, req.user.id);
            if (!passcodeHash) return res.status(400).json({ error: req.t('noPasscodeSet') });

            const match = await bcrypt.compare(req.body.passcode, passcodeHash);
            if (!match) return res.status(401).json({ error: 'Wrong passcode' });

            await query(
                'UPDATE user_settings SET passcode_hash = NULL, passcode_enabled = FALSE, updated_at = NOW() WHERE user_id = $1',
                [req.user.id]
            );
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.put('/passcode/timeout', async (req, res) => {
        try {
            await query(
                `INSERT INTO user_settings (user_id, passcode_timeout, updated_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (user_id)
                 DO UPDATE SET passcode_timeout = $2, updated_at = NOW()`,
                [req.user.id, req.body.timeout]
            );
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

async function getPasscodeHash(query, userId) {
    const result = await query('SELECT passcode_hash FROM user_settings WHERE user_id = $1', [userId]);
    return result.rows[0]?.passcode_hash || null;
}

module.exports = createUserPasscodeRoutes;

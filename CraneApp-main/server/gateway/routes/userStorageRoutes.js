const express = require('express');
const fs = require('fs');
const path = require('path');

function createUserStorageRoutes({ authMiddleware, logger, projectRoot, query }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/storage', async (req, res) => {
        try {
            const messageSize = await query(
                'SELECT COALESCE(SUM(LENGTH(content)), 0) as size FROM messages WHERE sender_id = $1 AND is_deleted = FALSE',
                [req.user.id]
            );
            const mediaRows = await query(
                'SELECT media_url FROM messages WHERE sender_id = $1 AND media_url IS NOT NULL AND is_deleted = FALSE',
                [req.user.id]
            );
            const settings = await query('SELECT storage_settings FROM user_settings WHERE user_id = $1', [req.user.id]);
            const fileSizes = calculateUploadSizes(projectRoot, mediaRows.rows);

            res.json({
                storage: {
                    messages: parseInt(messageSize.rows[0]?.size || 0, 10),
                    media: fileSizes.media,
                    files: fileSizes.files,
                    cache: 0,
                },
                settings: settings.rows[0]?.storage_settings || {},
            });
        } catch (error) {
            logger.error('❌ Get storage error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.put('/storage/settings', async (req, res) => {
        try {
            const current = await getStorageSettings(query, req.user.id);
            const settings = { ...current, ...req.body };
            await query(
                `INSERT INTO user_settings (user_id, storage_settings, updated_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (user_id)
                 DO UPDATE SET storage_settings = $2, updated_at = NOW()`,
                [req.user.id, JSON.stringify(settings)]
            );
            res.json({ success: true, settings });
        } catch (error) {
            logger.error('❌ Update storage settings error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/storage/cache', (req, res) => {
        logger.info('✅ Cache cleared for:', req.user.id);
        res.json({ success: true });
    });

    router.delete('/storage/all', async (req, res) => {
        try {
            await query('DELETE FROM messages WHERE sender_id = $1', [req.user.id]);
            await query('DELETE FROM chat_members WHERE user_id = $1', [req.user.id]);
            await query('DELETE FROM user_settings WHERE user_id = $1', [req.user.id]);
            await query('DELETE FROM user_sessions WHERE user_id = $1', [req.user.id]);
            await query('DELETE FROM blocked_users WHERE user_id = $1', [req.user.id]);
            logger.info('✅ All data deleted for:', req.user.id);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Delete all data error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

async function getStorageSettings(query, userId) {
    const current = await query('SELECT storage_settings FROM user_settings WHERE user_id = $1', [userId]);
    return current.rows[0]?.storage_settings || {};
}

function calculateUploadSizes(projectRoot, rows) {
    return rows.reduce((sizes, row) => {
        try {
            const filePath = path.join(projectRoot, row.media_url);
            if (!fs.existsSync(filePath)) return sizes;

            const stat = fs.statSync(filePath);
            if (/\.(jpg|jpeg|png|gif|webp|mp4|mov)$/i.test(row.media_url)) {
                sizes.media += stat.size;
            } else {
                sizes.files += stat.size;
            }
        } catch (_) {}
        return sizes;
    }, { media: 0, files: 0 });
}

module.exports = createUserStorageRoutes;

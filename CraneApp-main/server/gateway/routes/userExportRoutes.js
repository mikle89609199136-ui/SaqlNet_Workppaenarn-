const express = require('express');

function createUserExportRoutes({ authMiddleware, logger, query }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/export', async (req, res) => {
        try {
            const [userResult, chatsResult, settingsResult] = await Promise.all([
                query(
                    'SELECT id, username, first_name, last_name, bio, created_at FROM users WHERE id = $1',
                    [req.user.id]
                ),
                query(
                    `SELECT c.id, c.title, c.type, c.created_at
                     FROM chats c
                     JOIN chat_members cm ON c.id = cm.chat_id
                     WHERE cm.user_id = $1`,
                    [req.user.id]
                ),
                query('SELECT * FROM user_settings WHERE user_id = $1', [req.user.id]),
            ]);

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="craneapp_data.json"');
            res.send(JSON.stringify({
                user: userResult.rows[0],
                chats: chatsResult.rows,
                settings: settingsResult.rows[0],
                exportedAt: new Date().toISOString(),
            }, null, 2));
        } catch (error) {
            logger.error('❌ Export data error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = createUserExportRoutes;

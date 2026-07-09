const express = require('express');

function createBlockedUserRoutes({ authMiddleware, logger, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/blocked', async (req, res) => {
        try {
            const result = await query(
                `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, b.blocked_at
                 FROM blocked_users b
                 JOIN users u ON b.blocked_user_id = u.id
                 WHERE b.user_id = $1
                 ORDER BY b.blocked_at DESC`,
                [req.user.id]
            );

            res.json({
                blocked: result.rows.map((user) => ({
                    id: user.id,
                    username: user.username,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    avatarUrl: user.avatar_url,
                    blockedAt: user.blocked_at,
                })),
            });
        } catch (error) {
            logger.error('❌ Get blocked users error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/blocked', async (req, res) => {
        try {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId required' });
            if (userId === req.user.id) return res.status(400).json({ error: 'Cannot block yourself' });

            const userCheck = await query('SELECT id FROM users WHERE id = $1', [userId]);
            if (userCheck.rows.length === 0) return res.status(404).json({ error: req.t('userNotFound') });

            const existing = await query(
                'SELECT id FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2',
                [req.user.id, userId]
            );
            if (existing.rows.length > 0) return res.status(400).json({ error: 'User already blocked' });

            await query(
                'INSERT INTO blocked_users (id, user_id, blocked_user_id, blocked_at) VALUES ($1, $2, $3, NOW())',
                [uuidv4(), req.user.id, userId]
            );

            logger.info('✅ User blocked:', userId);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Block user error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/blocked/:blockedUserId', async (req, res) => {
        try {
            await query(
                'DELETE FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2',
                [req.user.id, req.params.blockedUserId]
            );

            logger.info('✅ User unblocked:', req.params.blockedUserId);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Unblock user error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = createBlockedUserRoutes;

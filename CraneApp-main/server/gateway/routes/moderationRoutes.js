const express = require('express');

function createModerationRoutes({ authMiddleware, isDeveloper, logger, query }) {
    const router = express.Router();
    const developerOnly = requireDeveloper(isDeveloper);

    router.use(authMiddleware);

    router.post('/:userId/forgive', developerOnly, async (req, res) => {
        try {
            await query('UPDATE users SET is_blocked = FALSE WHERE id = $1', [req.params.userId]);
            await resolvePendingReports(query, req.params.userId);
            res.json({ success: true });
        } catch (error) {
            logger.error('Forgive user error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/:userId/mute', developerOnly, async (req, res) => {
        try {
            const mutedUntil = calculateMuteUntil(req.body.duration);
            await query(
                'UPDATE users SET is_muted = TRUE, muted_until = $1, mute_reason = $2 WHERE id = $3',
                [mutedUntil, req.body.reason || null, req.params.userId]
            );
            await resolvePendingReports(query, req.params.userId);
            res.json({ success: true, mutedUntil });
        } catch (error) {
            logger.error('Mute user error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/:userId/block', developerOnly, async (req, res) => {
        try {
            await query(
                'UPDATE users SET is_blocked = TRUE, block_reason = $1 WHERE id = $2',
                [req.body.reason || null, req.params.userId]
            );
            await resolvePendingReports(query, req.params.userId);
            res.json({ success: true });
        } catch (error) {
            logger.error('Block user error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/:userId/unmute', developerOnly, async (req, res) => {
        try {
            await query(
                'UPDATE users SET is_muted = FALSE, muted_until = NULL, mute_reason = NULL WHERE id = $1',
                [req.params.userId]
            );
            res.json({ success: true });
        } catch (error) {
            logger.error('Unmute user error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/:userId/unblock', developerOnly, async (req, res) => {
        try {
            await query(
                'UPDATE users SET is_blocked = FALSE, block_reason = NULL WHERE id = $1',
                [req.params.userId]
            );
            res.json({ success: true });
        } catch (error) {
            logger.error('Unblock user error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

function requireDeveloper(isDeveloper) {
    return (req, res, next) => {
        if (!isDeveloper(req.user.username)) return res.status(403).json({ error: 'Forbidden' });
        next();
    };
}

function calculateMuteUntil(duration) {
    if (duration === 'forever') return null;
    const durations = {
        '1h': 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
    };
    return durations[duration] ? new Date(Date.now() + durations[duration]) : null;
}

function resolvePendingReports(query, userId) {
    return query(
        "UPDATE reports SET status = 'resolved' WHERE reported_user_id = $1 AND status = 'pending'",
        [userId]
    );
}

module.exports = createModerationRoutes;

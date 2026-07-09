const express = require('express');

function createReportRoutes({ authMiddleware, isDeveloper, logger, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.post('/', async (req, res) => {
        try {
            const { reportedUserId, reason, description } = req.body;
            if (!reportedUserId || !reason) {
                return res.status(400).json({ error: 'reportedUserId and reason are required' });
            }

            const user = await query('SELECT id, username FROM users WHERE id = $1', [reportedUserId]);
            if (user.rows.length === 0) return res.status(404).json({ error: req.t('userNotFound') });

            const reportId = uuidv4();
            await query(
                `INSERT INTO reports (id, reporter_id, reported_user_id, reason, description, status, created_at)
                 VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
                [reportId, req.user.id, reportedUserId, reason, description || null]
            );
            res.json({ success: true, reportId });
        } catch (error) {
            logger.error('Report creation error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/', requireDeveloper(isDeveloper), async (req, res) => {
        try {
            const result = await query(`${reportSelectSql()} ORDER BY r.created_at DESC`);
            res.json({ reports: result.rows });
        } catch (error) {
            logger.error('Get reports error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/:reportId', requireDeveloper(isDeveloper), async (req, res) => {
        try {
            const result = await query(`${reportSelectSql()} WHERE r.id = $1`, [req.params.reportId]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Report not found' });
            res.json({ report: result.rows[0] });
        } catch (error) {
            logger.error('Get report details error:', error);
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

function reportSelectSql() {
    return `SELECT r.*,
                   u.username as reported_username,
                   u.first_name as reported_first_name,
                   u.avatar_url as reported_avatar_url,
                   ru.username as reporter_username
            FROM reports r
            LEFT JOIN users u ON r.reported_user_id = u.id
            LEFT JOIN users ru ON r.reporter_id = ru.id`;
}

module.exports = createReportRoutes;

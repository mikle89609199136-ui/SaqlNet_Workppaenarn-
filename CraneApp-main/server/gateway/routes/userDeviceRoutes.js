const express = require('express');
const http = require('http');

function createUserDeviceRoutes({ authMiddleware, logger, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.post('/devices/register', async (req, res) => {
        try {
            const { deviceName, deviceType, userAgent, clientIP } = req.body;
            const existing = await query(
                'SELECT id FROM user_sessions WHERE user_id = $1 AND user_agent = $2 LIMIT 1',
                [req.user.id, userAgent]
            );

            if (existing.rows.length > 0) {
                const sessionId = existing.rows[0].id;
                await setCurrentSession(query, req.user.id, sessionId);
                return res.json({ success: true, sessionId });
            }

            const sessionId = uuidv4();
            const ip = clientIP || (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
            const location = await resolveLocation(ip, req);

            await query(
                `INSERT INTO user_sessions
                    (id, user_id, device_name, device_type, ip_address, location, user_agent, last_active, first_login, is_current)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), TRUE)`,
                [sessionId, req.user.id, deviceName, deviceType, ip, location, userAgent]
            );
            await query('UPDATE user_sessions SET is_current = FALSE WHERE user_id = $1 AND id != $2', [req.user.id, sessionId]);

            logger.info('✅ Session registered:', sessionId);
            res.json({ success: true, sessionId });
        } catch (error) {
            logger.error('❌ Register session error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/devices', async (req, res) => {
        try {
            const result = await query(
                `SELECT id, device_name, device_type, ip_address, location,
                        last_active, first_login, is_current
                 FROM user_sessions
                 WHERE user_id = $1
                 ORDER BY last_active DESC`,
                [req.user.id]
            );
            res.json({ devices: result.rows });
        } catch (error) {
            logger.error('❌ Get devices error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/devices/:sessionId', async (req, res) => {
        try {
            const session = await query(
                'SELECT id, is_current FROM user_sessions WHERE id = $1 AND user_id = $2',
                [req.params.sessionId, req.user.id]
            );
            if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
            if (session.rows[0].is_current) return res.status(400).json({ error: 'Cannot terminate current session' });

            await query('DELETE FROM user_sessions WHERE id = $1', [req.params.sessionId]);
            logger.info('✅ Session terminated:', req.params.sessionId);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Delete device error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/devices/terminate-all', async (req, res) => {
        try {
            const current = await query(
                'SELECT id FROM user_sessions WHERE user_id = $1 AND is_current = TRUE LIMIT 1',
                [req.user.id]
            );
            const currentSessionId = current.rows[0]?.id;

            if (currentSessionId) {
                await query('DELETE FROM user_sessions WHERE user_id = $1 AND id != $2', [req.user.id, currentSessionId]);
            } else {
                await query('DELETE FROM user_sessions WHERE user_id = $1', [req.user.id]);
            }

            logger.info('✅ All other sessions terminated for:', req.user.id);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Terminate all devices error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

async function setCurrentSession(query, userId, sessionId) {
    await query('UPDATE user_sessions SET last_active = NOW(), is_current = TRUE WHERE id = $1', [sessionId]);
    await query('UPDATE user_sessions SET is_current = FALSE WHERE user_id = $1 AND id != $2', [userId, sessionId]);
}

async function resolveLocation(ip, req) {
    if (!ip) return req.t('unknown');

    const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    const ipv6Regex = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$|^::1$|^::$/i;

    if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
        return req.t('unknown');
    }

    const isPrivate = ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.') ||
        ip.startsWith('192.168.') || ip.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) || ip.startsWith('169.254.');

    if (isPrivate) {
        return req.t('localNetwork');
    }

    try {
        const geoData = await new Promise((resolve, reject) => {
            http.get(`http://ip-api.com/json/${ip}?fields=city,country&lang=${encodeURIComponent(req.locale || 'ru')}`, (response) => {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (_) { resolve({}); }
                });
            }).on('error', reject);
        });

        if (geoData.city) return `${geoData.city}, ${geoData.country}`;
        if (geoData.country) return geoData.country;
    } catch (_) {}

    return req.t('unknown');
}

module.exports = createUserDeviceRoutes;

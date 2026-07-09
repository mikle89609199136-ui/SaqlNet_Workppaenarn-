const express = require('express');

function createUserPreferenceRoutes({ authMiddleware, logger, query }) {
    const router = express.Router();

    router.use(authMiddleware);

    addPreferencePair(router, {
        path: '/notifications',
        column: 'notification_settings',
        key: 'settings',
        fallback: {
            privateChats: true,
            groups: true,
            channels: true,
            calls: true,
            videoCalls: true,
            inAppNotifications: true,
            messagePreview: true,
            readReceipts: false,
            reactions: true,
            newContacts: true,
        },
        logName: 'notification settings',
        logger,
        query,
    });

    addPreferencePair(router, {
        path: '/sounds',
        column: 'sound_settings',
        key: 'settings',
        fallback: {
            notificationsVolume: 80,
            mediaVolume: 100,
            notificationsSound: true,
            messagesSound: true,
            sendSound: true,
            callsSound: true,
            vibrateOnCall: true,
            notificationSound: 'default',
            messageSound: 'default',
            ringtone: 'default',
        },
        logName: 'sound settings',
        logger,
        query,
    });

    addPreferencePair(router, {
        path: '/advanced-settings',
        column: 'advanced_settings',
        key: 'settings',
        fallback: {
            autoReconnect: true,
            fastConnection: true,
            connectionType: 'auto',
            dataCompression: true,
            saveDrafts: true,
            analytics: false,
            developerMode: false,
            debugLog: false,
            hardwareAcceleration: true,
            autoplayGifs: true,
        },
        logName: 'advanced settings',
        logger,
        query,
    });

    router.get('/folders', async (req, res) => {
        try {
            const result = await query('SELECT folders FROM user_settings WHERE user_id = $1', [req.user.id]);
            res.json({ folders: result.rows[0]?.folders || [] });
        } catch (error) {
            logger.error('❌ Get folders error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.put('/folders', async (req, res) => {
        try {
            await query(
                `INSERT INTO user_settings (user_id, folders, updated_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (user_id)
                 DO UPDATE SET folders = $2, updated_at = NOW()`,
                [req.user.id, JSON.stringify(req.body.folders)]
            );
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Update folders error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

function addPreferencePair(router, { path, column, key, fallback, logName, logger, query }) {
    router.get(path, async (req, res) => {
        try {
            const current = await getJsonColumn(query, req.user.id, column);
            res.json({ [key]: Object.keys(current).length ? current : fallback });
        } catch (error) {
            logger.error(`❌ Get ${logName} error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    router.put(path, async (req, res) => {
        try {
            const current = await getJsonColumn(query, req.user.id, column);
            const updated = { ...current, ...req.body };
            await upsertJsonColumn(query, req.user.id, column, updated);
            res.json({ success: true, [key]: updated });
        } catch (error) {
            logger.error(`❌ Update ${logName} error:`, error);
            res.status(500).json({ error: error.message });
        }
    });
}

async function getJsonColumn(query, userId, column) {
    const result = await query(`SELECT ${column} FROM user_settings WHERE user_id = $1`, [userId]);
    return result.rows[0]?.[column] || {};
}

function upsertJsonColumn(query, userId, column, value) {
    return query(
        `INSERT INTO user_settings (user_id, ${column}, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET ${column} = $2, updated_at = NOW()`,
        [userId, JSON.stringify(value)]
    );
}

module.exports = createUserPreferenceRoutes;

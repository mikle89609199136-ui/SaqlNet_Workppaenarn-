const express = require('express');

function createUserSettingsRoutes({ authMiddleware, broadcastSettingsUpdated, i18n, logger, query }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/all-settings', async (req, res) => {
        try {
            const result = await query(
                `SELECT settings, privacy_settings, notification_settings, sound_settings,
                        storage_settings, advanced_settings, folders,
                        passcode_enabled, passcode_timeout
                 FROM user_settings WHERE user_id = $1`,
                [req.user.id]
            );
            const row = result.rows[0] || {};

            res.json({
                settings: row.settings || {},
                privacySettings: row.privacy_settings || {},
                notificationSettings: row.notification_settings || {},
                soundSettings: row.sound_settings || {},
                storageSettings: row.storage_settings || {},
                advancedSettings: row.advanced_settings || {},
                folders: row.folders || [],
                passcodeEnabled: row.passcode_enabled || false,
                passcodeTimeout: row.passcode_timeout || 60,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.put('/all-settings', async (req, res) => {
        try {
            const current = await getCurrentSettings(query, req.user.id);
            const values = buildAllSettingsValues(req.user.id, current, req.body);

            await query(
                `INSERT INTO user_settings
                    (user_id, settings, privacy_settings, notification_settings,
                     sound_settings, storage_settings, advanced_settings, folders, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
                 ON CONFLICT (user_id) DO UPDATE SET
                    settings              = COALESCE($2, user_settings.settings),
                    privacy_settings      = COALESCE($3, user_settings.privacy_settings),
                    notification_settings = COALESCE($4, user_settings.notification_settings),
                    sound_settings        = COALESCE($5, user_settings.sound_settings),
                    storage_settings      = COALESCE($6, user_settings.storage_settings),
                    advanced_settings     = COALESCE($7, user_settings.advanced_settings),
                    folders               = COALESCE($8, user_settings.folders),
                    updated_at            = NOW()`,
                values
            );

            if (req.body.settings?.language) {
                const lang = i18n.normalizeLanguage(req.body.settings.language);
                if (lang) {
                    await query('UPDATE users SET language = $1 WHERE id = $2', [lang, req.user.id]);
                    req.locale = lang;
                }
            }

            broadcastSettingsUpdated(req.user.id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/settings', async (req, res) => {
        try {
            const result = await query('SELECT settings FROM user_settings WHERE user_id = $1', [req.user.id]);
            res.json({ settings: result.rows[0]?.settings || defaultSettings() });
        } catch (error) {
            logger.error('❌ Get settings error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.put('/settings', async (req, res) => {
        try {
            const current = await getJsonColumn(query, req.user.id, 'settings');
            const settings = {
                ...current,
                theme: req.body.theme !== undefined ? req.body.theme : current.theme || 'dark',
                notifications: req.body.notifications !== undefined ? req.body.notifications : current.notifications,
                sounds: req.body.sounds !== undefined ? req.body.sounds : current.sounds,
                language: req.body.language !== undefined ? req.body.language : current.language || 'ru',
                accentColor: req.body.accentColor !== undefined ? req.body.accentColor : current.accentColor || '#FF007F',
                fontSize: req.body.fontSize !== undefined ? req.body.fontSize : current.fontSize || 'medium',
            };

            await upsertJsonColumn(query, req.user.id, 'settings', settings);

            if (req.body.language !== undefined) {
                const lang = i18n.normalizeLanguage(req.body.language);
                if (lang) await query('UPDATE users SET language = $1 WHERE id = $2', [lang, req.user.id]);
            }

            logger.info('✅ Settings updated for:', req.user.id);
            res.json({ success: true, settings });
        } catch (error) {
            logger.error('❌ Update settings error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/privacy', async (req, res) => {
        try {
            const privacy = await getJsonColumn(query, req.user.id, 'privacy_settings');
            res.json({ privacy: Object.keys(privacy).length ? privacy : defaultPrivacy() });
        } catch (error) {
            logger.error('❌ Get privacy error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.put('/privacy', async (req, res) => {
        try {
            const current = await getJsonColumn(query, req.user.id, 'privacy_settings');
            const privacy = { ...current, ...req.body };
            await upsertJsonColumn(query, req.user.id, 'privacy_settings', privacy);
            logger.info('✅ Privacy settings updated for:', req.user.id);
            res.json({ success: true, privacy });
        } catch (error) {
            logger.error('❌ Update privacy error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

async function getCurrentSettings(query, userId) {
    const current = await query(
        `SELECT settings, privacy_settings, notification_settings, sound_settings,
                storage_settings, advanced_settings, folders
         FROM user_settings WHERE user_id = $1`,
        [userId]
    );
    return current.rows[0] || {};
}

function buildAllSettingsValues(userId, current, body) {
    return [
        userId,
        body.settings ? JSON.stringify({ ...(current.settings || {}), ...body.settings }) : null,
        body.privacySettings ? JSON.stringify({ ...(current.privacy_settings || {}), ...body.privacySettings }) : null,
        body.notificationSettings ? JSON.stringify({ ...(current.notification_settings || {}), ...body.notificationSettings }) : null,
        body.soundSettings ? JSON.stringify({ ...(current.sound_settings || {}), ...body.soundSettings }) : null,
        body.storageSettings ? JSON.stringify({ ...(current.storage_settings || {}), ...body.storageSettings }) : null,
        body.advancedSettings ? JSON.stringify({ ...(current.advanced_settings || {}), ...body.advancedSettings }) : null,
        body.folders ? JSON.stringify(body.folders) : null,
    ];
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

function defaultSettings() {
    return { theme: 'dark', notifications: true, sounds: true, language: 'ru' };
}

function defaultPrivacy() {
    return {
        lastSeen: 'all',
        phoneVisibility: 'contacts',
        photoVisibility: 'all',
        messagesFromStrangers: true,
        groupsAdd: 'all',
        twoFactorAuth: false,
        autoDeleteAccount: true,
    };
}

module.exports = createUserSettingsRoutes;

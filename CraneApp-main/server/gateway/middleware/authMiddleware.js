function createAuthMiddleware({ i18n, jwt, logger, query }) {
    return async function authMiddleware(req, res, next) {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({
                    error: req.t ? req.t('noToken') : i18n.t(i18n.languageFromHeaders(req), 'noToken'),
                });
            }

            if (!process.env.JWT_SECRET) {
                logger.error('JWT_SECRET is not configured');
                return res.status(500).json({
                    error: req.t
                        ? req.t('serverConfigError')
                        : i18n.t(i18n.languageFromHeaders(req), 'serverConfigError'),
                });
            }

            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const result = await query(
                `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, u.bio, u.badge, u.badges,
                        u.is_bot, u.is_blocked, u.is_muted, u.muted_until, u.is_premium, u.status_emoji,
                        u.block_reason, u.mute_reason, u.language, us.settings->>'language' AS settings_language
                 FROM users u
                 LEFT JOIN user_settings us ON us.user_id = u.id
                 WHERE u.id = $1`,
                [decoded.userId ?? decoded.subject]
            );

            if (result.rows.length === 0) {
                return res.status(401).json({ error: req.t('userNotFound') });
            }

            req.user = result.rows[0];
            req.locale = i18n.normalizeLanguage(req.user.settings_language)
                || i18n.normalizeLanguage(req.user.language)
                || req.locale;
            req.t = (key, vars) => i18n.t(req.locale, key, vars);

            if (req.user.is_blocked) {
                const errorMessage = req.user.block_reason
                    ? req.t('accountBlockedReason', { reason: req.user.block_reason })
                    : req.t('accountBlocked');
                return res.status(403).json({ error: errorMessage });
            }

            if (req.user.is_muted && req.user.muted_until && new Date(req.user.muted_until) < new Date()) {
                await query(
                    'UPDATE users SET is_muted = FALSE, muted_until = NULL, mute_reason = NULL WHERE id = $1',
                    [req.user.id]
                );
                req.user.is_muted = false;
            }

            next();
        } catch (error) {
            logger.error('Auth middleware error:', error);
            return res.status(401).json({
                error: req.t ? req.t('invalidToken') : i18n.t(i18n.languageFromHeaders(req), 'invalidToken'),
            });
        }
    };
}

module.exports = createAuthMiddleware;

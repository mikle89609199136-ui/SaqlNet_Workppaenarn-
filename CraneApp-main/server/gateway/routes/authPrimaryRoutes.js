const express = require('express');

const DEFAULT_USER_SETTINGS = {
    settings: { theme: 'dark', notifications: true, sounds: true },
    privacy: { lastSeen: 'all', phoneVisibility: 'contacts', photoVisibility: 'all', messagesFromStrangers: true, groupsAdd: 'all', twoFactorAuth: false, autoDeleteAccount: true },
    notifications: { privateChats: true, groups: true, channels: true, calls: true, videoCalls: true, inAppNotifications: true, messagePreview: true, readReceipts: false, reactions: true, newContacts: true },
    sounds: { notificationsVolume: 80, mediaVolume: 100, notificationsSound: true, messagesSound: true, sendSound: true, callsSound: true, vibrateOnCall: true, notificationSound: 'default', messageSound: 'default', ringtone: 'default' },
    storage: { autoDownloadMobile: true, autoDownloadWifi: true, autoDownloadRoaming: false, deleteMediaAfter: 'never' },
    advanced: { autoReconnect: true, fastConnection: true, connectionType: 'auto', dataCompression: true, saveDrafts: true, analytics: false, developerMode: false, debugLog: false, hardwareAcceleration: true, autoplayGifs: true },
};

function createAuthPrimaryRoutes(deps) {
    const router = express.Router();
    const { authLimiter } = deps;

    router.post('/register', authLimiter, (req, res) => register(req, res, deps));
    router.post('/login', authLimiter, (req, res) => login(req, res, deps));

    return router;
}

async function register(req, res, { bcrypt, createCraneAppBotChat, i18n, jwt, logger, query, uuidv4 }) {
    try {
        const { username, password, firstName, lastName } = req.body;
        const lang = i18n.normalizeLanguage(req.body.language) || req.locale || 'ru';
        const validationError = validateRegistration(req, { firstName, password, username });
        if (validationError) return res.status(400).json({ error: validationError });

        const existing = await query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
        if (existing.rows.length > 0) return res.status(400).json({ error: req.t('usernameTaken') });

        const user = await insertUser({ bcrypt, firstName, lang, lastName, password, query, username, uuidv4 });
        const token = signToken({ jwt, logger, req, res, user });
        if (!token) return;

        await insertDefaultSettings(query, user.id, lang);
        await createCraneAppBotChat(user.id);

        logger.info('✅ New user registered: ' + user.username);
        res.status(201).json({ user: mapAuthUser(user), token });
    } catch (error) {
        logger.error('❌ Register error:', error);
        res.status(500).json({ error: error.message });
    }
}

async function login(req, res, deps) {
    const { bcrypt, isDeveloper, jwt, loginNotifications, logger, maxLoginAttempts, query, security } = deps;
    try {
        const { username, password, clientIP: bodyClientIP } = req.body;
        const ip = security.getIP(req);
        if (!username || !password) return res.status(400).json({ error: req.t('usernamePasswordRequired') });
        if (handleBruteForce({ ip, logger, req, res, security, username })) return;

        await security.timingAttackDelay(200);
        const result = await query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
        if (!result.rows.length) return failLogin({ ip, req, res, security, username });

        const user = result.rows[0];
        if (user.is_blocked) return res.status(403).json({ error: req.t('accountBlockedSupport') });
        if (!(await bcrypt.compare(password, user.password_hash))) {
            const attempts = security.recordFailedLogin(ip, username);
            security.addSuspiciousScore(ip, 3);
            return res.status(401).json({ error: req.t('invalidUsernamePassword'), attemptsLeft: Math.max(maxLoginAttempts - attempts, 0) });
        }

        security.recordSuccessfulLogin(ip, username);
        await query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]);
        if (isDeveloper(user.username)) await grantDeveloperBadge(query, user.id);
        if (await requiresTwoFactor({ bcrypt, req, res, user })) return;

        const token = signToken({ jwt, logger, req, res, user });
        if (!token) return;
        security.registerSession(user.id, token);
        notifyLogin({ bodyClientIP, loginNotifications, req, user });

        logger.info('✅ User logged in: ' + user.username);
        res.status(200).json({ user: mapAuthUser(user), token });
    } catch (error) {
        logger.error('❌ Login error:', error);
        res.status(500).json({ error: error.message });
    }
}

function validateRegistration(req, { firstName, password, username }) {
    if (!username || username.length < 3 || username.length > 32) return req.t('usernameLength');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return req.t('usernameFormat');
    if (!password || password.length < 6) return req.t('passwordMin');
    if (!firstName) return req.t('firstNameRequired');
    return null;
}

async function insertUser({ bcrypt, firstName, lang, lastName, password, query, username, uuidv4 }) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await query(
        `INSERT INTO users (id, username, password_hash, first_name, last_name, phone, bio, avatar_url, language, created_at, last_seen)
         VALUES ($1, $2, $3, $4, $5, NULL, '', '', $6, NOW(), NOW())
         RETURNING id, username, first_name, last_name, bio, avatar_url`,
        [uuidv4(), username.toLowerCase(), hashedPassword, firstName, lastName || '', lang]
    );
    return result.rows[0];
}

function insertDefaultSettings(query, userId, lang) {
    const settings = { ...DEFAULT_USER_SETTINGS.settings, language: lang };
    return query(
        `INSERT INTO user_settings (user_id, settings, privacy_settings, notification_settings, sound_settings, storage_settings, advanced_settings, folders)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, settings, DEFAULT_USER_SETTINGS.privacy, DEFAULT_USER_SETTINGS.notifications, DEFAULT_USER_SETTINGS.sounds, DEFAULT_USER_SETTINGS.storage, DEFAULT_USER_SETTINGS.advanced, []].map((value, index) => index === 0 ? value : JSON.stringify(value))
    );
}

function signToken({ jwt, logger, req, res, user }) {
    if (!process.env.JWT_SECRET) {
        logger.error('JWT_SECRET is not configured');
        res.status(500).json({ error: req.t('serverConfigError') });
        return null;
    }
    return jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function handleBruteForce({ ip, logger, req, res, security, username }) {
    const bruteCheck = security.checkBruteForce(ip, username);
    if (!bruteCheck.blocked) return false;
    logger.warn(`🔒 Login blocked for ${username} from ${ip}`);
    res.status(429).json({ error: req.t('tooManyFailedAttempts', { minutes: bruteCheck.remaining }) });
    return true;
}

function failLogin({ ip, req, res, security, username }) {
    security.recordFailedLogin(ip, username);
    security.addSuspiciousScore(ip, 3);
    return res.status(401).json({ error: req.t('invalidUsernamePassword') });
}

function grantDeveloperBadge(query, userId) {
    return query(
        `UPDATE users SET badges = array_append(COALESCE(badges,'{}'), 'developer')
         WHERE id = $1 AND NOT ('developer' = ANY(COALESCE(badges,'{}')))`,
        [userId]
    );
}

async function requiresTwoFactor({ bcrypt, req, res, user }) {
    if (!user.two_fa_enabled) return false;
    if (!req.body.twoFAPassword) {
        res.status(200).json({ twoFARequired: true, userId: user.id });
        return true;
    }
    if (!(await bcrypt.compare(req.body.twoFAPassword, user.two_fa_hash))) {
        res.status(401).json({ error: req.t('invalid2FA') });
        return true;
    }
    return false;
}

function notifyLogin({ bodyClientIP, loginNotifications, req, user }) {
    const serverIP = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    loginNotifications.notifyInBackground({
        userId: user.id,
        ip: bodyClientIP || serverIP,
        userAgent: req.headers['user-agent'] || '',
        locale: req.locale,
    });
}

function mapAuthUser(user) {
    return {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        bio: user.bio || '',
        avatarUrl: user.avatar_url || '',
    };
}

module.exports = createAuthPrimaryRoutes;

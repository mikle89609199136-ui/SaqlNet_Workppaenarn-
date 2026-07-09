const express = require('express');

function createUserProfileRoutes({
    authMiddleware,
    handleFileUpload,
    isDeveloper,
    logger,
    QRCode,
    query,
}) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/users/me', async (req, res) => {
        try {
            if (isDeveloper(req.user.username)) {
                await query(
                    `UPDATE users SET badges = array_append(COALESCE(badges,'{}'), 'developer')
                     WHERE id = $1 AND NOT ('developer' = ANY(COALESCE(badges,'{}')))`,
                    [req.user.id]
                );
                req.user.badges ||= [];
                if (!req.user.badges.includes('developer')) req.user.badges.push('developer');
            }
            if (req.user.is_premium) {
                await query(
                    `UPDATE users SET badges = array_append(COALESCE(badges,'{}'), 'premium')
                     WHERE id = $1 AND NOT ('premium' = ANY(COALESCE(badges,'{}')))`,
                    [req.user.id]
                );
            }

            res.json({ user: mapCurrentUser(req.user) });
        } catch (error) {
            logger.error('❌ Get user me error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/users/check-username', async (req, res) => {
        try {
            const { username } = req.query;
            if (!username) return res.status(400).json({ error: 'username required' });

            const result = await query(
                'SELECT id FROM users WHERE username = $1 AND id != $2',
                [username.toLowerCase(), req.user.id]
            );
            res.json({ available: result.rows.length === 0 });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/premium/subscribe', (req, res) => {
        const { plan } = req.body;
        logger.info('✅ Premium subscription initiated for:', req.user.id, 'plan:', plan);
        res.json({ success: true, message: 'Premium subscription initiated', plan });
    });

    router.get('/users/search', async (req, res) => {
        try {
            const { q } = req.query;
            if (!q || q.length < 1) return res.status(400).json({ error: 'Minimum 1 character' });

            const result = await query(
                `SELECT id, username, first_name, last_name, avatar_url
                 FROM users
                 WHERE (username ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1 OR CONCAT(first_name, ' ', last_name) ILIKE $1)
                 AND id != $2
                 LIMIT 50`,
                [`%${q}%`, req.user.id]
            );
            res.status(200).json({ users: result.rows.map(mapUserRow) });
        } catch (error) {
            logger.error('❌ Search error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/messages/search', async (req, res) => {
        try {
            const { q } = req.query;
            if (!q || q.length < 1) return res.status(400).json({ error: 'Minimum 1 character' });

            const result = await query(
                `SELECT m.id, m.chat_id, m.sender_id, m.content, m.content_plain, m.created_at, m.media_type, m.media_url,
                        m.media_encrypted, m.media_encryption,
                        c.type as chat_type, c.name as chat_name,
                        u.username, u.first_name, u.last_name, u.avatar_url
                 FROM messages m
                 JOIN chats c ON m.chat_id = c.id
                 JOIN users u ON m.sender_id = u.id
                 JOIN chat_members cp ON c.id = cp.chat_id
                 WHERE cp.user_id = $1
                 AND (m.content_plain ILIKE $2 OR (m.content_plain IS NULL AND m.content ILIKE $2))
                 ORDER BY m.created_at DESC
                 LIMIT 50`,
                [req.user.id, `%${q}%`]
            );
            res.status(200).json({ messages: result.rows.map(mapMessageSearchRow) });
        } catch (error) {
            logger.error('❌ Message search error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    const profileUpdateHandler = async (req, res) => {
        try {
            const result = await updateProfile({ handleFileUpload, query, userId: req.user.id, body: req.body });
            if (!result) return res.status(400).json({ error: 'No fields to update' });

            logger.info('✅ Profile updated for:', req.user.id);
            res.json({ success: true, user: mapUpdatedUser(result.rows[0]) });
        } catch (error) {
            logger.error('❌ Update profile error:', error);
            res.status(500).json({ error: error.message });
        }
    };

    router.put('/users/profile', profileUpdateHandler);
    router.put('/users/me', profileUpdateHandler);

    router.put('/users/avatar', async (req, res) => {
        try {
            if (!req.body.avatar) return res.status(400).json({ error: 'Avatar required' });

            const avatarUrl = handleFileUpload(req.body.avatar, 'avatar');
            await query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.user.id]);
            logger.info('✅ Avatar updated for:', req.user.id);
            res.json({ success: true, avatarUrl });
        } catch (error) {
            logger.error('❌ Update avatar error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/users/qr-code', async (req, res) => {
        try {
            const { username } = req.query;
            if (!username) return res.status(400).json({ error: 'Username required' });

            const userResult = await query('SELECT id, username FROM users WHERE username = $1', [username]);
            if (userResult.rows.length === 0) return res.status(404).json({ error: req.t('userNotFound') });

            const host = req.get('host');
            const protocol = req.headers['x-forwarded-proto'] || req.protocol;
            const qrCode = await QRCode.toDataURL(`${protocol}://${host}/user/@${username}`, {
                width: 256,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' },
            });
            res.json({ qrCode, username });
        } catch (error) {
            logger.error('QR code generation error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/users/:userId/profile', async (req, res) => {
        try {
            const result = await query(
                'SELECT id, username, first_name, last_name, bio, avatar_url, status_emoji, is_blocked, is_muted, muted_until FROM users WHERE id = $1',
                [req.params.userId]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: req.t('userNotFound') });

            const user = result.rows[0];
            res.json({
                user: {
                    id: user.id,
                    username: user.username,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    bio: user.bio,
                    avatarUrl: user.avatar_url,
                    statusEmoji: user.status_emoji,
                    isBlocked: user.is_blocked,
                    isMuted: user.is_muted,
                    mutedUntil: user.muted_until,
                },
            });
        } catch (error) {
            logger.error('❌ Get user profile error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/users/:userId/status', async (req, res) => {
        try {
            const result = await query(
                `SELECT u.id, u.last_seen, u.is_online, us.privacy_settings
                 FROM users u
                 LEFT JOIN user_settings us ON us.user_id = u.id
                 WHERE u.id = $1`,
                [req.params.userId]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: req.t('userNotFound') });

            const status = await resolveVisibleStatus({ query, target: result.rows[0], viewerId: req.user.id });
            res.json(status);
        } catch (error) {
            logger.error('❌ Get user status error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

function mapCurrentUser(user) {
    return {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        bio: user.bio || '',
        avatarUrl: user.avatar_url || '',
        statusEmoji: user.status_emoji || '',
        badge: user.badge || null,
        badges: user.badges || [],
        isBot: user.is_bot || false,
        isPremium: user.is_premium || false,
    };
}

function mapUserRow(user) {
    return {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        avatarUrl: user.avatar_url,
    };
}

function mapMessageSearchRow(message) {
    return {
        id: message.id,
        chatId: message.chat_id,
        senderId: message.sender_id,
        content: message.content_plain || message.content,
        createdAt: message.created_at,
        mediaType: message.media_type,
        mediaUrl: message.media_url,
        mediaEncrypted: message.media_encrypted || false,
        mediaEncryption: message.media_encryption || null,
        chatType: message.chat_type,
        chatName: message.chat_name,
        senderUsername: message.username,
        senderFirstName: message.first_name,
        senderLastName: message.last_name,
        senderAvatarUrl: message.avatar_url,
    };
}

function mapUpdatedUser(user) {
    return {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        bio: user.bio || '',
        avatarUrl: user.avatar_url || '',
        statusEmoji: user.status_emoji || '',
    };
}

async function updateProfile({ handleFileUpload, query, userId, body }) {
    const fields = [
        ['firstName', 'first_name', body.firstName],
        ['lastName', 'last_name', body.lastName],
        ['bio', 'bio', body.bio],
        ['statusEmoji', 'status_emoji', body.statusEmoji],
    ];
    const updates = [];
    const values = [];
    let index = 1;

    fields.forEach(([, column, value]) => {
        if (value !== undefined) {
            updates.push(`${column} = $${index++}`);
            values.push(value);
        }
    });

    if (body.avatar !== undefined) {
        updates.push(`avatar_url = $${index++}`);
        values.push(handleFileUpload(body.avatar, 'avatar'));
    }

    if (updates.length === 0) return null;
    values.push(userId);
    return query(
        `UPDATE users SET ${updates.join(', ')}
         WHERE id = $${index}
         RETURNING id, username, first_name, last_name, bio, avatar_url, status_emoji`,
        values
    );
}

async function resolveVisibleStatus({ query, target, viewerId }) {
    let isOnline = target.is_online;
    let lastSeen = target.last_seen;
    const lastSeenSetting = target.privacy_settings?.lastSeen || 'all';

    if (lastSeenSetting === 'none') {
        isOnline = false;
        lastSeen = null;
    } else if (lastSeenSetting === 'contacts') {
        const contactCheck = await query(
            `SELECT 1 FROM chats c
             JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = $1
             JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = $2
             WHERE c.type = 'private' LIMIT 1`,
            [target.id, viewerId]
        );
        if (contactCheck.rows.length === 0) {
            isOnline = false;
            lastSeen = null;
        }
    }

    return { userId: target.id, isOnline, lastSeen };
}

module.exports = createUserProfileRoutes;

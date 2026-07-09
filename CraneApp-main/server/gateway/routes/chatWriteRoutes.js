const express = require('express');

function createChatWriteRoutes({ authMiddleware, broadcastToChat, handleFileUpload, logger, pool, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.post('/groups', async (req, res) => {
        try {
            const { title, description, members, avatar } = req.body;
            if (!title || !title.trim()) return res.status(400).json({ error: req.t('titleRequired') });
            if (!members || !Array.isArray(members) || members.length === 0) {
                return res.status(400).json({ error: req.t('membersRequired') });
            }

            await enforceGroupPrivacy({ members, query, req });
            const chatId = uuidv4();
            const avatarUrl = avatar ? tryUploadAvatar(handleFileUpload, avatar) : null;
            const allMembers = [...new Set([req.user.id, ...members])];

            await query(
                `INSERT INTO chats (id, type, title, description, owner_id, avatar_url, created_at)
                 VALUES ($1, 'group', $2, $3, $4, $5, NOW())`,
                [chatId, title.trim(), description || '', req.user.id, avatarUrl]
            );
            await insertGroupMembers(query, chatId, allMembers, req.user.id);
            await insertGroupSystemMessage({ chatId, query, req, title, uuidv4 });
            await broadcastToChat(chatId, { type: 'new_chat', chatId, chatType: 'group', title: title.trim() }, null);

            logger.info('✅ Group created:', chatId);
            res.status(201).json({ chatId, title: title.trim() });
        } catch (error) {
            logger.error('❌ Create group error:', error);
            res.status(error.status || 500).json({ error: error.message });
        }
    });

    router.post('/private', async (req, res) => {
        const client = await pool.connect();
        try {
            const otherUserId = req.body.userId || getPrivateChatPeer(req.body.participants, req.user.id);
            if (!otherUserId) return res.status(400).json({ error: 'Invalid participants' });

            const blocked = await query('SELECT 1 FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2', [otherUserId, req.user.id]);
            if (blocked.rows.length > 0) return res.status(403).json({ error: 'You are blocked by this user' });

            await client.query('BEGIN');
            const chatId = await createPrivateChatIfMissing({ client, currentUserId: req.user.id, otherUserId, req, uuidv4 });
            await client.query('COMMIT');

            if (chatId.exists) {
                logger.info('✅ Existing chat found:', chatId.id);
                return res.status(200).json({ chatId: chatId.id, exists: true });
            }

            logger.info('✅ New chat created:', chatId.id);
            await broadcastNewPrivateChat({ broadcastToChat, chatId: chatId.id, query, req });
            res.status(201).json({ chatId: chatId.id, exists: false });
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('❌ Create chat error:', error);
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    router.delete('/:chatId', async (req, res) => {
        try {
            if (!(await isChatMember(query, req.params.chatId, req.user.id))) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }
            await deleteOrLeaveChat(query, req.params.chatId, req.user.id);
            logger.info('✅ Chat deleted/left:', req.params.chatId);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Delete chat error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.patch('/:chatId', async (req, res) => {
        try {
            const { chatId } = req.params;
            const { title, description, avatar } = req.body;

            const chatRes = await query('SELECT type, owner_id FROM chats WHERE id = $1', [chatId]);
            if (chatRes.rows.length === 0) return res.status(404).json({ error: 'Chat not found' });
            const chat = chatRes.rows[0];

            if (chat.type !== 'group' && chat.type !== 'channel') {
                return res.status(400).json({ error: 'Cannot update non-group chat info' });
            }

            const modRes = await query('SELECT role, permissions FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, req.user.id]);
            if (modRes.rows.length === 0) return res.status(403).json({ error: req.t('accessDenied') });
            const member = modRes.rows[0];

            const perms = typeof member.permissions === 'string' ? JSON.parse(member.permissions) : (member.permissions || {});
            if (member.role !== 'owner' && perms.can_change_info !== true) {
                return res.status(403).json({ error: 'Missing permission: can_change_info' });
            }

            const updates = [];
            const params = [];
            let paramIdx = 1;

            if (title !== undefined && title.trim()) {
                updates.push(`title = $${paramIdx++}`);
                params.push(title.trim());
                updates.push(`name = $${paramIdx++}`);
                params.push(title.trim());
            }
            if (description !== undefined) {
                updates.push(`description = $${paramIdx++}`);
                params.push(description);
            }
            if (avatar !== undefined) {
                const avatarUrl = avatar ? tryUploadAvatar(handleFileUpload, avatar) : null;
                updates.push(`avatar_url = $${paramIdx++}`);
                params.push(avatarUrl);
            }

            if (updates.length > 0) {
                params.push(chatId);
                await query(`UPDATE chats SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIdx}`, params);
                
                broadcastToChat(chatId, {
                    type: 'chat_info_updated',
                    chatId,
                    title: title ? title.trim() : undefined,
                    description,
                    avatarUrl: avatar !== undefined ? params[paramIdx - 2] : undefined
                });
            }

            res.json({ success: true });
        } catch (error) {
            logger.error('Update chat info error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/:chatId/pin', async (req, res) => updateChatFlag(req, res, {
        query,
        logger,
        flag: 'is_pinned',
        timestamp: 'pinned_at',
        value: true,
        log: '✅ Chat pinned:',
    }));

    router.delete('/:chatId/pin', async (req, res) => updateChatFlag(req, res, {
        query,
        logger,
        flag: 'is_pinned',
        timestamp: 'pinned_at',
        value: false,
        log: '✅ Chat unpinned:',
    }));

    router.post('/:chatId/archive', async (req, res) => updateChatFlag(req, res, {
        query,
        logger,
        flag: 'is_archived',
        timestamp: 'archived_at',
        value: true,
        log: '✅ Chat archived:',
    }));

    router.delete('/:chatId/archive', async (req, res) => updateChatFlag(req, res, {
        query,
        logger,
        flag: 'is_archived',
        timestamp: 'archived_at',
        value: false,
        log: '✅ Chat unarchived:',
    }));

    router.post('/:chatId/read', async (req, res) => {
        try {
            if (!(await isChatMember(query, req.params.chatId, req.user.id))) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }
            await ensureUserChatSettings(query);
            const result = await query(
                `INSERT INTO user_chat_settings (user_id, chat_id, last_read_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (user_id, chat_id) DO UPDATE SET last_read_at = NOW()
                 RETURNING last_read_at`,
                [req.user.id, req.params.chatId]
            );
            res.json({ success: true, unreadCount: 0, lastReadAt: result.rows[0]?.last_read_at || new Date() });
        } catch (error) {
            logger.error('❌ Mark chat read error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

async function enforceGroupPrivacy({ members, query, req }) {
    for (const memberId of members) {
        if (memberId === req.user.id) continue;
        const privacyResult = await query('SELECT privacy_settings FROM user_settings WHERE user_id = $1', [memberId]);
        const groupsAdd = (privacyResult.rows[0]?.privacy_settings || {}).groupsAdd || 'all';
        if (groupsAdd === 'none') throwPrivacyError(await privacyName(query, memberId, req), req, 'groupAddPrivacyNone');
        if (groupsAdd === 'contacts' && !(await hasPrivateChat(query, memberId, req.user.id))) {
            throwPrivacyError(await privacyName(query, memberId, req), req, 'groupAddPrivacyContacts');
        }
    }
}

function throwPrivacyError(name, req, key) {
    const error = new Error(req.t(key, { name }));
    error.status = 403;
    throw error;
}

async function privacyName(query, memberId, req) {
    const user = await query('SELECT first_name, username FROM users WHERE id = $1', [memberId]);
    return user.rows[0]?.first_name || user.rows[0]?.username || req.t('user');
}

async function hasPrivateChat(query, userA, userB) {
    const result = await query(
        `SELECT 1 FROM chats c
         JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = $1
         JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = $2
         WHERE c.type = 'private' LIMIT 1`,
        [userA, userB]
    );
    return result.rows.length > 0;
}

function tryUploadAvatar(handleFileUpload, avatar) {
    try {
        return handleFileUpload(avatar, 'avatar');
    } catch (_) {
        return null;
    }
}

function insertGroupMembers(query, chatId, members, ownerId) {
    const values = members.map((userId, index) =>
        `($1, $${index + 2}, '${userId === ownerId ? 'owner' : 'member'}', '{}'::jsonb, NOW())`
    ).join(', ');
    return query(`INSERT INTO chat_members (chat_id, user_id, role, permissions, joined_at) VALUES ${values}`, [chatId, ...members]);
}

async function insertGroupSystemMessage({ chatId, query, req, title, uuidv4 }) {
    const bot = await query("SELECT id FROM users WHERE username = 'craneapp_bot'");
    const senderId = bot.rows.length ? bot.rows[0].id : req.user.id;
    return query(
        'INSERT INTO messages (id, chat_id, sender_id, content, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [uuidv4(), chatId, senderId, req.t('groupCreatedSystem', { name: `"${title.trim()}"` })]
    );
}

function getPrivateChatPeer(participants, currentUserId) {
    if (!participants || !Array.isArray(participants) || participants.length === 0) return null;
    return participants.find((id) => id !== currentUserId) || null;
}

async function createPrivateChatIfMissing({ client, currentUserId, otherUserId, req, uuidv4 }) {
    const [id1, id2] = [currentUserId, otherUserId].sort();
    await client.query('SELECT 1 FROM users WHERE id = $1 OR id = $2 FOR UPDATE', [id1, id2]);
    const existing = await client.query(
        `SELECT c.id FROM chats c
         JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = $1
         JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = $2
         WHERE c.type = 'private'`,
        [currentUserId, otherUserId]
    );
    if (existing.rows.length > 0) return { id: existing.rows[0].id, exists: true };

    const chatId = uuidv4();
    await client.query(
        'INSERT INTO chats (id, type, title, owner_id, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [chatId, req.body.type || 'private', req.t('privateChatTitle'), currentUserId]
    );
    await client.query(
        `INSERT INTO chat_members (chat_id, user_id, role, joined_at)
         VALUES ($1, $2, 'owner', NOW()), ($1, $3, 'member', NOW())`,
        [chatId, currentUserId, otherUserId]
    );
    return { id: chatId, exists: false };
}

async function broadcastNewPrivateChat({ broadcastToChat, chatId, query, req }) {
    const senderInfo = await query('SELECT first_name, username, avatar_url FROM users WHERE id = $1', [req.user.id]);
    const sender = senderInfo.rows[0] || {};
    return broadcastToChat(chatId, {
        type: 'new_chat',
        chatId,
        chatType: 'private',
        senderId: req.user.id,
        senderName: sender.first_name || sender.username || req.t('user'),
        senderAvatar: sender.avatar_url || '',
    }, req.user.id);
}

async function deleteOrLeaveChat(query, chatId, userId) {
    const chatInfo = await query('SELECT type, owner_id FROM chats WHERE id = $1', [chatId]);
    if (chatInfo.rows[0].type === 'private') {
        await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
        const remaining = await query('SELECT COUNT(*) FROM chat_members WHERE chat_id = $1', [chatId]);
        if (parseInt(remaining.rows[0].count, 10) === 0) {
            await query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
            await query('DELETE FROM chats WHERE id = $1', [chatId]);
        }
        return;
    }
    if (chatInfo.rows[0].owner_id === userId) {
        await query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
        await query('DELETE FROM chat_members WHERE chat_id = $1', [chatId]);
        await query('DELETE FROM chats WHERE id = $1', [chatId]);
        return;
    }
    await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
}

async function updateChatFlag(req, res, { query, logger, flag, timestamp, value, log }) {
    try {
        if (value && !(await isChatMember(query, req.params.chatId, req.user.id))) {
            return res.status(403).json({ error: req.t('accessDenied') });
        }
        await query(`
            INSERT INTO user_chat_settings (user_id, chat_id, ${flag}, ${timestamp})
            VALUES ($1, $2, $3, ${value ? 'NOW()' : 'NULL'})
            ON CONFLICT (user_id, chat_id) DO UPDATE SET ${flag} = $3, ${timestamp} = ${value ? 'NOW()' : 'NULL'}
        `, [req.user.id, req.params.chatId, value]);
        logger.info(log, req.params.chatId);
        res.json({ success: true, [flag === 'is_pinned' ? 'isPinned' : 'isArchived']: value });
    } catch (error) {
        logger.error(`❌ Update chat ${flag} error:`, error);
        res.status(500).json({ error: error.message });
    }
}

function isChatMember(query, chatId, userId) {
    return query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId])
        .then((result) => result.rows.length > 0);
}

async function ensureUserChatSettings(query) {
    await query(`
        CREATE TABLE IF NOT EXISTS user_chat_settings (
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
            is_pinned BOOLEAN DEFAULT FALSE,
            pinned_at TIMESTAMP,
            is_archived BOOLEAN DEFAULT FALSE,
            archived_at TIMESTAMP,
            last_read_at TIMESTAMP,
            PRIMARY KEY (user_id, chat_id)
        )
    `).catch(() => {});
    await query('ALTER TABLE user_chat_settings ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP').catch(() => {});
}

module.exports = createChatWriteRoutes;

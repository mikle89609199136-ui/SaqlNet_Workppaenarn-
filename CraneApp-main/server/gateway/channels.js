/**
 * Channel routes and helpers for CraneApp.
 * Registers Telegram-like channel APIs on the Express app.
 */

function normalizeChannelUsername(username) {
    if (!username || typeof username !== 'string') return null;
    const u = username.replace(/^@/, '').trim().toLowerCase();
    if (!/^[a-z0-9_]{5,32}$/.test(u)) return null;
    return u;
}

async function getChannelMember(query, chatId, userId) {
    const r = await query(
        'SELECT role, permissions FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [chatId, userId]
    );
    return r.rows[0] || null;
}

async function canPostToChannel(query, chatId, userId) {
    const member = await getChannelMember(query, chatId, userId);
    if (!member) return false;
    if (member.role === 'owner') return true;
    if (member.role === 'admin') {
        const perms = member.permissions || {};
        if (perms.can_post_messages === false || perms.can_post_messages === 'false') return false;
        return true;
    }
    return false;
}

async function canManageChannel(query, chatId, userId) {
    const member = await getChannelMember(query, chatId, userId);
    if (!member) return false;
    return member.role === 'owner' || member.role === 'admin';
}

async function getSubscriberCount(query, chatId) {
    const r = await query(
        'SELECT COUNT(*)::int AS cnt FROM chat_members WHERE chat_id = $1',
        [chatId]
    );
    return r.rows[0]?.cnt || 0;
}

async function buildChannelPayload(query, chatRow, userId) {
    const member = userId ? await getChannelMember(query, chatRow.id, userId) : null;
    const subscriberCount = await getSubscriberCount(query, chatRow.id);
    let discussionChat = null;
    if (chatRow.discussion_chat_id) {
        const d = await query(
            'SELECT id, title, type FROM chats WHERE id = $1',
            [chatRow.discussion_chat_id]
        );
        if (d.rows[0]) {
            discussionChat = {
                id: d.rows[0].id,
                title: d.rows[0].title,
                type: d.rows[0].type
            };
        }
    }
    return {
        id: chatRow.id,
        type: 'channel',
        title: chatRow.title,
        description: chatRow.description || '',
        avatarUrl: chatRow.avatar_url || '',
        username: chatRow.username || null,
        isPublic: !!chatRow.is_public,
        ownerId: chatRow.owner_id,
        subscriberCount,
        discussionChatId: chatRow.discussion_chat_id || null,
        discussionChat,
        role: member?.role || null,
        isSubscribed: !!member,
        canPost: member ? await canPostToChannel(query, chatRow.id, userId) : false,
        canManage: member ? await canManageChannel(query, chatRow.id, userId) : false
    };
}

async function publishScheduledMessages({ query, broadcastToChat, logger, uuidv4 }) {
    const due = await query(
        `SELECT m.*, c.title AS chat_title
         FROM messages m
         JOIN chats c ON c.id = m.chat_id AND c.type = 'channel'
         WHERE m.scheduled_at IS NOT NULL
           AND m.published_at IS NULL
           AND m.scheduled_at <= NOW()
           AND m.is_deleted = FALSE
         LIMIT 20`
    );
    for (const row of due.rows) {
        await query(
            'UPDATE messages SET published_at = NOW() WHERE id = $1',
            [row.id]
        );
        const senderRes = await query(
            'SELECT id, username, first_name, last_name, avatar_url, badge, is_bot FROM users WHERE id = $1',
            [row.sender_id]
        );
        const sender = senderRes.rows[0] || {};
        const message = {
            id: row.id,
            chatId: row.chat_id,
            senderId: row.sender_id,
            sender: {
                id: sender.id,
                username: sender.username,
                firstName: sender.first_name,
                lastName: sender.last_name,
                avatarUrl: sender.avatar_url,
                badge: sender.badge || null,
                isBot: sender.is_bot || false
            },
            content: row.content,
            type: row.media_type || row.type || 'text',
            mediaUrl: row.media_url,
            isSilent: row.is_silent || false,
            authorSignature: row.author_signature || null,
            viewsCount: row.views_count || 0,
            commentCount: row.comment_count || 0,
            createdAt: new Date(),
            publishedAt: new Date()
        };
        broadcastToChat(row.chat_id, {
            type: 'new_message',
            chatId: row.chat_id,
            chatType: 'channel',
            chatTitle: row.chat_title,
            message
        }, null);
        logger.info('📢 Scheduled channel post published:', row.id);
    }
}

function registerChannelRoutes(app, deps) {
    const {
        authMiddleware,
        query,
        uuidv4,
        broadcastToChat,
        handleFileUpload,
        logger,
        buildMessagePayload
    } = deps;

    // CREATE CHANNEL
    app.post('/api/v1/chats/create-channel', authMiddleware, async (req, res) => {
        try {
            const { title, description, username, isPublic, avatar } = req.body;
            if (!title || !title.trim()) {
                return res.status(400).json({ error: req.t('titleRequired') });
            }

            const chatId = uuidv4();
            let channelUsername = null;
            if (isPublic) {
                channelUsername = normalizeChannelUsername(username || title);
                if (!channelUsername) {
                    return res.status(400).json({ error: 'Некорректный username канала (5-32 символа, a-z, 0-9, _)' });
                }
                const taken = await query(
                    `SELECT 1 FROM chats WHERE LOWER(username) = $1 AND type = 'channel'`,
                    [channelUsername]
                );
                if (taken.rows.length) {
                    return res.status(400).json({ error: 'Этот username канала уже занят' });
                }
                const userTaken = await query(
                    'SELECT 1 FROM users WHERE LOWER(username) = $1',
                    [channelUsername]
                );
                if (userTaken.rows.length) {
                    return res.status(400).json({ error: 'Этот username уже занят пользователем' });
                }
            }

            let avatarUrl = null;
            if (avatar) {
                try { avatarUrl = handleFileUpload(avatar, 'avatar'); } catch (_) {}
            }

            await query(
                `INSERT INTO chats (id, type, title, description, owner_id, avatar_url, username, is_public, created_at)
                 VALUES ($1, 'channel', $2, $3, $4, $5, $6, $7, NOW())`,
                [chatId, title.trim(), description || '', req.user.id, avatarUrl, channelUsername, !!isPublic]
            );

            await query(
                `INSERT INTO chat_members (chat_id, user_id, role, permissions, joined_at)
                 VALUES ($1, $2, 'owner', $3, NOW())`,
                [chatId, req.user.id, JSON.stringify({ can_post_messages: true, can_edit_messages: true, can_delete_messages: true, can_invite_users: true })]
            );

            await broadcastToChat(chatId, { type: 'new_chat', chatId, chatType: 'channel', title: title.trim() }, null);

            logger.info('✅ Channel created:', chatId);
            res.status(201).json({ chatId, title: title.trim(), username: channelUsername });
        } catch (error) {
            logger.error('❌ Create channel error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // SEARCH PUBLIC CHANNELS
    app.get('/api/v1/channels/search', authMiddleware, async (req, res) => {
        try {
            const q = (req.query.q || '').trim().replace(/^@/, '');
            if (!q || q.length < 2) {
                return res.json({ channels: [] });
            }
            const result = await query(
                `SELECT c.*,
                        (SELECT COUNT(*)::int FROM chat_members cm WHERE cm.chat_id = c.id) AS subscriber_count,
                        EXISTS(SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.id AND cm.user_id = $2) AS is_subscribed
                 FROM chats c
                 WHERE c.type = 'channel'
                   AND c.is_public = TRUE
                   AND (
                       c.title ILIKE $1
                       OR c.username ILIKE $1
                       OR ('@' || c.username) ILIKE $1
                   )
                 ORDER BY subscriber_count DESC
                 LIMIT 20`,
                [`%${q}%`, req.user.id]
            );
            res.json({
                channels: result.rows.map(c => ({
                    id: c.id,
                    title: c.title,
                    description: c.description || '',
                    avatarUrl: c.avatar_url || '',
                    username: c.username,
                    subscriberCount: c.subscriber_count || 0,
                    isSubscribed: c.is_subscribed
                }))
            });
        } catch (error) {
            logger.error('❌ Channel search error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET CHANNEL BY USERNAME
    app.get('/api/v1/channels/by-username/:username', authMiddleware, async (req, res) => {
        try {
            const uname = normalizeChannelUsername(req.params.username);
            if (!uname) return res.status(400).json({ error: 'Invalid username' });
            const result = await query(
                `SELECT * FROM chats WHERE type = 'channel' AND LOWER(username) = $1`,
                [uname]
            );
            if (!result.rows.length) return res.status(404).json({ error: 'Канал не найден' });
            const channel = result.rows[0];
            if (!channel.is_public) {
                const member = await getChannelMember(query, channel.id, req.user.id);
                if (!member) return res.status(403).json({ error: req.t('accessDenied') });
            }
            res.json({ channel: await buildChannelPayload(query, channel, req.user.id) });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // GET CHANNEL INFO
    app.get('/api/v1/channels/:chatId', authMiddleware, async (req, res) => {
        try {
            const { chatId } = req.params;
            const result = await query(
                `SELECT * FROM chats WHERE id = $1 AND type = 'channel'`,
                [chatId]
            );
            if (!result.rows.length) return res.status(404).json({ error: 'Канал не найден' });
            const channel = result.rows[0];
            const member = await getChannelMember(query, chatId, req.user.id);
            if (!channel.is_public && !member) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }
            res.json({ channel: await buildChannelPayload(query, channel, req.user.id) });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // SUBSCRIBE
    app.post('/api/v1/channels/:chatId/subscribe', authMiddleware, async (req, res) => {
        try {
            const { chatId } = req.params;
            const chatRes = await query(
                `SELECT * FROM chats WHERE id = $1 AND type = 'channel'`,
                [chatId]
            );
            if (!chatRes.rows.length) return res.status(404).json({ error: 'Канал не найден' });
            const channel = chatRes.rows[0];

            const existing = await getChannelMember(query, chatId, req.user.id);
            if (existing) {
                return res.json({ success: true, alreadySubscribed: true });
            }

            if (!channel.is_public) {
                return res.status(403).json({ error: 'Это приватный канал. Нужна пригласительная ссылка.' });
            }

            await query(
                `INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW())`,
                [chatId, req.user.id]
            );

            await broadcastToChat(chatId, {
                type: 'channel_subscribed',
                chatId,
                userId: req.user.id
            }, null);

            res.json({ success: true, subscriberCount: await getSubscriberCount(query, chatId) });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // UNSUBSCRIBE
    app.delete('/api/v1/channels/:chatId/subscribe', authMiddleware, async (req, res) => {
        try {
            const { chatId } = req.params;
            const member = await getChannelMember(query, chatId, req.user.id);
            if (!member) return res.status(404).json({ error: 'Вы не подписаны' });
            if (member.role === 'owner') {
                return res.status(400).json({ error: 'Владелец не может отписаться. Удалите канал.' });
            }
            await query(
                'DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2',
                [chatId, req.user.id]
            );
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // UPDATE CHANNEL SETTINGS
    app.patch('/api/v1/channels/:chatId/settings', authMiddleware, async (req, res) => {
        try {
            const { chatId } = req.params;
            if (!await canManageChannel(query, chatId, req.user.id)) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }
            const { title, description, username, isPublic, avatar } = req.body;
            const updates = [];
            const params = [];
            let idx = 1;

            if (title !== undefined) {
                updates.push(`title = $${idx++}`);
                params.push(title.trim());
            }
            if (description !== undefined) {
                updates.push(`description = $${idx++}`);
                params.push(description);
            }
            if (isPublic !== undefined) {
                updates.push(`is_public = $${idx++}`);
                params.push(!!isPublic);
            }
            if (username !== undefined) {
                const uname = normalizeChannelUsername(username);
                if (!uname) return res.status(400).json({ error: 'Некорректный username' });
                const taken = await query(
                    `SELECT 1 FROM chats WHERE LOWER(username) = $1 AND type = 'channel' AND id != $2`,
                    [uname, chatId]
                );
                if (taken.rows.length) return res.status(400).json({ error: 'Username занят' });
                updates.push(`username = $${idx++}`);
                params.push(uname);
            }
            if (avatar) {
                try {
                    const avatarUrl = handleFileUpload(avatar, 'avatar');
                    updates.push(`avatar_url = $${idx++}`);
                    params.push(avatarUrl);
                } catch (_) {}
            }

            if (!updates.length) return res.json({ success: true });
            params.push(chatId);
            await query(
                `UPDATE chats SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} AND type = 'channel'`,
                params
            );

            const refreshed = await query('SELECT * FROM chats WHERE id = $1', [chatId]);
            res.json({ success: true, channel: await buildChannelPayload(query, refreshed.rows[0], req.user.id) });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // LINK / UNLINK DISCUSSION GROUP
    app.post('/api/v1/channels/:chatId/discussion', authMiddleware, async (req, res) => {
        try {
            const { chatId } = req.params;
            const { discussionChatId } = req.body;

            const channelRes = await query(
                `SELECT * FROM chats WHERE id = $1 AND type = 'channel'`,
                [chatId]
            );
            if (!channelRes.rows.length) return res.status(404).json({ error: 'Канал не найден' });
            if (!await canManageChannel(query, chatId, req.user.id)) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }

            if (!discussionChatId) {
                await query(
                    'UPDATE chats SET discussion_chat_id = NULL WHERE id = $1',
                    [chatId]
                );
                return res.json({ success: true, discussionChatId: null });
            }

            const groupRes = await query(
                `SELECT id, type, title FROM chats WHERE id = $1`,
                [discussionChatId]
            );
            if (!groupRes.rows.length || groupRes.rows[0].type !== 'group') {
                return res.status(400).json({ error: 'Можно привязать только групповой чат' });
            }
            const member = await getChannelMember(query, discussionChatId, req.user.id);
            if (!member) {
                return res.status(403).json({ error: 'Вы должны состоять в группе обсуждения' });
            }

            await query(
                'UPDATE chats SET discussion_chat_id = $1 WHERE id = $2',
                [discussionChatId, chatId]
            );
            res.json({
                success: true,
                discussionChatId,
                discussionTitle: groupRes.rows[0].title
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // GET POST COMMENTS
    app.get('/api/v1/channels/:chatId/posts/:messageId/comments', authMiddleware, async (req, res) => {
        try {
            const { chatId, messageId } = req.params;
            const member = await getChannelMember(query, chatId, req.user.id);
            if (!member) return res.status(403).json({ error: req.t('accessDenied') });

            const postCheck = await query(
                `SELECT id FROM messages WHERE id = $1 AND chat_id = $2 AND parent_message_id IS NULL AND is_deleted = FALSE`,
                [messageId, chatId]
            );
            if (!postCheck.rows.length) return res.status(404).json({ error: 'Пост не найден' });

            const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
            const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

            const result = await query(
                `SELECT m.*, u.username AS sender_username, u.first_name AS sender_first_name,
                        u.avatar_url AS sender_avatar, u.is_bot AS sender_is_bot
                 FROM messages m
                 LEFT JOIN users u ON u.id = m.sender_id
                 WHERE m.chat_id = $1 AND m.parent_message_id = $2 AND m.is_deleted = FALSE
                 ORDER BY m.created_at ASC
                 LIMIT $3 OFFSET $4`,
                [chatId, messageId, limit, offset]
            );

            res.json({
                comments: result.rows.map(m => ({
                    id: m.id,
                    chatId: m.chat_id,
                    parentMessageId: m.parent_message_id,
                    senderId: m.sender_id,
                    senderUsername: m.sender_username,
                    senderFirstName: m.sender_first_name,
                    senderAvatar: m.sender_avatar,
                    senderIsBot: m.sender_is_bot || false,
                    content: m.content,
                    type: m.type || 'text',
                    mediaUrl: m.media_url,
                    createdAt: m.created_at
                }))
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ADD COMMENT
    app.post('/api/v1/channels/:chatId/posts/:messageId/comments', authMiddleware, async (req, res) => {
        try {
            const { chatId, messageId } = req.params;
            const { content, type = 'text', mediaUrl, mediaType } = req.body;

            const member = await getChannelMember(query, chatId, req.user.id);
            if (!member) return res.status(403).json({ error: 'Подпишитесь на канал, чтобы комментировать' });

            const postCheck = await query(
                `SELECT id FROM messages WHERE id = $1 AND chat_id = $2 AND parent_message_id IS NULL AND is_deleted = FALSE`,
                [messageId, chatId]
            );
            if (!postCheck.rows.length) return res.status(404).json({ error: 'Пост не найден' });

            if (!content && !mediaUrl) {
                return res.status(400).json({ error: 'Пустой комментарий' });
            }

            const commentId = uuidv4();
            await query(
                `INSERT INTO messages (id, chat_id, sender_id, content, content_plain, type, parent_message_id, media_url, media_type, published_at, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
                [commentId, chatId, req.user.id, content || '', content || '', mediaType || type, messageId, mediaUrl || null, mediaType || null]
            );
            await query(
                `UPDATE messages SET comment_count = COALESCE(comment_count, 0) + 1 WHERE id = $1`,
                [messageId]
            );

            const message = {
                id: commentId,
                chatId,
                parentMessageId: messageId,
                senderId: req.user.id,
                senderFirstName: req.user.first_name,
                senderUsername: req.user.username,
                senderAvatar: req.user.avatar_url,
                content: content || '',
                type: mediaType || type,
                mediaUrl: mediaUrl || null,
                createdAt: new Date()
            };

            broadcastToChat(chatId, {
                type: 'channel_comment',
                chatId,
                postId: messageId,
                comment: message
            }, null);

            res.status(201).json({ comment: message });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // RECORD POST VIEW
    app.post('/api/v1/channels/:chatId/posts/:messageId/view', authMiddleware, async (req, res) => {
        try {
            const { chatId, messageId } = req.params;
            const member = await getChannelMember(query, chatId, req.user.id);
            if (!member) return res.status(403).json({ error: req.t('accessDenied') });

            const postCheck = await query(
                `SELECT id, views_count FROM messages WHERE id = $1 AND chat_id = $2 AND parent_message_id IS NULL`,
                [messageId, chatId]
            );
            if (!postCheck.rows.length) return res.status(404).json({ error: 'Пост не найден' });

            const inserted = await query(
                `INSERT INTO message_views (message_id, user_id, viewed_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (message_id, user_id) DO NOTHING
                 RETURNING message_id`,
                [messageId, req.user.id]
            );

            let viewsCount = postCheck.rows[0].views_count || 0;
            if (inserted.rows.length) {
                const upd = await query(
                    `UPDATE messages SET views_count = COALESCE(views_count, 0) + 1 WHERE id = $1 RETURNING views_count`,
                    [messageId]
                );
                viewsCount = upd.rows[0]?.views_count || viewsCount + 1;
            }

            res.json({ viewsCount });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}

module.exports = {
    registerChannelRoutes,
    publishScheduledMessages,
    canPostToChannel,
    canManageChannel,
    getChannelMember,
    normalizeChannelUsername
};

const express = require('express');

function createChatReadRoutes({ authMiddleware, logger, query }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/', async (req, res) => {
        try {
            const result = await query(chatListSql('FALSE'), [req.user.id]);
            res.json({ chats: result.rows.map(mapChatRow) });
        } catch (error) {
            logger.error('❌ Get chats error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/archived', async (req, res) => {
        try {
            const result = await query(archivedChatSql(), [req.user.id]);
            res.json({ chats: result.rows.map(mapArchivedChatRow) });
        } catch (error) {
            logger.error('❌ Get archived chats error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/:chatId', async (req, res) => {
        try {
            const { chatId } = req.params;
            const result = await query(
                `SELECT c.*,
                        cm.role,
                        COALESCE(ucs.is_pinned, FALSE) AS user_is_pinned,
                        ucs.pinned_at AS user_pinned_at,
                        COALESCE(ucs.is_archived, FALSE) AS user_is_archived,
                        COALESCE(unread.unread_count, 0) AS unread_count,
                        lm.content AS last_message_content,
                        lm.type AS last_message_type,
                        lm.sender_id AS last_message_sender_id,
                        lm.is_encrypted AS last_message_encrypted,
                        lm.encryption_iv AS last_message_iv,
                        lm.created_at AS last_message_at
                 FROM chats c
                 JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $1
                 LEFT JOIN user_chat_settings ucs ON ucs.chat_id = c.id AND ucs.user_id = $1
                 LEFT JOIN LATERAL (
                     SELECT content, type, sender_id, is_encrypted, encryption_iv, created_at
                     FROM messages
                     WHERE chat_id = c.id AND is_deleted = FALSE
                     ORDER BY created_at DESC
                     LIMIT 1
                 ) lm ON TRUE
                 LEFT JOIN LATERAL (
                     SELECT COUNT(*)::int AS unread_count
                     FROM messages m
                     WHERE m.chat_id = c.id
                       AND m.is_deleted = FALSE
                       AND m.sender_id <> $1
                       AND (ucs.last_read_at IS NULL OR m.created_at > ucs.last_read_at)
                 ) unread ON TRUE
                 WHERE c.id = $2`,
                [req.user.id, chatId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Chat not found' });
            }

            res.json(mapChatRow(result.rows[0]));
        } catch (error) {
            logger.error('❌ Get chat error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/:chatId/members', async (req, res) => {
        try {
            const { chatId } = req.params;
            if (!(await isChatMember(query, chatId, req.user.id))) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }

            const result = await query(
                `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, u.last_seen, u.badge, u.badges,
                        u.is_bot, u.is_premium, u.is_blocked, u.status_emoji, cm.role, cm.permissions, cm.muted_until,
                        CASE WHEN u.last_seen > NOW() - INTERVAL '5 minutes' THEN TRUE ELSE FALSE END as is_online
                 FROM chat_members cm JOIN users u ON cm.user_id = u.id
                 WHERE cm.chat_id = $1`,
                [chatId]
            );
            res.json({ members: result.rows.map(mapMemberRow) });
        } catch (error) {
            logger.error('❌ Get members error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/:chatId/members-online', async (req, res) => {
        try {
            const result = await query(
                `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, u.is_bot, cm.role, cm.permissions, cm.muted_until,
                        CASE WHEN u.is_bot = TRUE THEN FALSE
                             WHEN u.last_seen > NOW() - INTERVAL '5 minutes' THEN TRUE
                             ELSE FALSE END as is_online
                 FROM chat_members cm JOIN users u ON cm.user_id = u.id
                 WHERE cm.chat_id = $1`,
                [req.params.chatId]
            );
            const members = result.rows;
            res.json({
                members: members.map(mapOnlineMemberRow),
                total: members.length,
                online: members.filter((member) => member.is_online && !member.is_bot).length,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

function chatListSql() {
    return `SELECT c.*,
                   cm.role,
                   COALESCE(ucs.is_pinned, FALSE) AS user_is_pinned,
                   ucs.pinned_at AS user_pinned_at,
                   COALESCE(ucs.is_archived, FALSE) AS user_is_archived,
                   COALESCE(unread.unread_count, 0) AS unread_count,
                   lm.content AS last_message_content,
                   lm.type AS last_message_type,
                   lm.sender_id AS last_message_sender_id,
                   lm.is_encrypted AS last_message_encrypted,
                   lm.encryption_iv AS last_message_iv,
                   lm.is_mls AS last_message_is_mls,
                   lm.mls_epoch AS last_message_mls_epoch,
                   lm.created_at AS last_message_at
            FROM chats c
            JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $1
            LEFT JOIN user_chat_settings ucs ON ucs.chat_id = c.id AND ucs.user_id = $1
            LEFT JOIN LATERAL (
                SELECT content, type, sender_id, is_encrypted, encryption_iv, is_mls, mls_epoch, created_at
                FROM messages
                WHERE chat_id = c.id AND is_deleted = FALSE
                ORDER BY created_at DESC
                LIMIT 1
            ) lm ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS unread_count
                FROM messages m
                WHERE m.chat_id = c.id
                  AND m.is_deleted = FALSE
                  AND m.sender_id <> $1
                  AND (ucs.last_read_at IS NULL OR m.created_at > ucs.last_read_at)
            ) unread ON TRUE
            WHERE COALESCE(ucs.is_archived, FALSE) = FALSE
            ORDER BY user_is_pinned DESC, user_pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST`;
}

function archivedChatSql() {
    return `SELECT c.*, cm.role,
                   lm.content AS last_message_content,
                   lm.type AS last_message_type,
                   lm.is_encrypted AS last_message_encrypted,
                   lm.encryption_iv AS last_message_iv,
                   lm.is_mls AS last_message_is_mls,
                   lm.mls_epoch AS last_message_mls_epoch,
                   lm.created_at AS last_message_at,
                   COALESCE(unread.unread_count, 0) AS unread_count,
                   ucs.archived_at AS user_archived_at
            FROM chats c
            JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $1
            JOIN user_chat_settings ucs ON c.id = ucs.chat_id AND ucs.user_id = $1 AND ucs.is_archived = TRUE
            LEFT JOIN LATERAL (
                SELECT content, type, is_encrypted, encryption_iv, is_mls, mls_epoch, created_at
                FROM messages
                WHERE chat_id = c.id AND is_deleted = FALSE
                ORDER BY created_at DESC LIMIT 1
            ) lm ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS unread_count
                FROM messages m
                WHERE m.chat_id = c.id
                  AND m.is_deleted = FALSE
                  AND m.sender_id <> $1
                  AND (ucs.last_read_at IS NULL OR m.created_at > ucs.last_read_at)
            ) unread ON TRUE
            ORDER BY ucs.archived_at DESC`;
}

function isChatMember(query, chatId, userId) {
    return query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId])
        .then((result) => result.rows.length > 0);
}

function mapChatRow(chat) {
    return {
        id: chat.id,
        type: chat.type,
        title: chat.title,
        ownerId: chat.owner_id,
        avatarUrl: chat.avatar_url,
        role: chat.role,
        isPinned: chat.user_is_pinned || false,
        isArchived: chat.user_is_archived || false,
        pinnedAt: chat.user_pinned_at,
        lastMessageAt: chat.last_message_at,
        lastMessage: chat.last_message_content || '',
        lastMessageEncrypted: chat.last_message_encrypted || false,
        lastMessageIv: chat.last_message_iv || null,
        lastMessageIsMls: chat.last_message_is_mls || false,
        lastMessageMlsEpoch: chat.last_message_mls_epoch || 0,
        lastMessageType: chat.last_message_type || 'text',
        lastMessageSenderId: chat.last_message_sender_id,
        unreadCount: chat.unread_count || 0,
    };
}

function mapArchivedChatRow(chat) {
    return {
        ...mapChatRow(chat),
        isPinned: false,
        isArchived: true,
        archivedAt: chat.user_archived_at,
    };
}

function mapMemberRow(member) {
    return {
        id: member.id,
        username: member.username,
        first_name: member.first_name,
        last_name: member.last_name,
        avatar_url: member.avatar_url,
        role: member.role,
        permissions: typeof member.permissions === 'string' ? JSON.parse(member.permissions) : (member.permissions || {}),
        muted_until: member.muted_until,
        last_seen: member.last_seen,
        is_online: member.is_online,
        badge: member.badge || null,
        badges: member.badges || [],
        is_bot: member.is_bot || false,
        is_premium: member.is_premium || false,
        is_blocked: member.is_blocked || false,
        statusEmoji: member.status_emoji || '',
    };
}

function mapOnlineMemberRow(member) {
    return {
        id: member.id,
        username: member.username,
        firstName: member.first_name,
        lastName: member.last_name,
        avatarUrl: member.avatar_url,
        role: member.role,
        permissions: typeof member.permissions === 'string' ? JSON.parse(member.permissions) : (member.permissions || {}),
        mutedUntil: member.muted_until,
        isBot: member.is_bot || false,
        isOnline: member.is_online,
    };
}

module.exports = createChatReadRoutes;

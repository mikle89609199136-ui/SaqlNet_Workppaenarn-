const express = require('express');

function createMessageReadRoutes({ authMiddleware, logger, query }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/messages/:chatId', async (req, res) => {
        try {
            if (!(await isChatMember(query, req.params.chatId, req.user.id))) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }
            const messages = await loadMessages({ query, req });
            await attachReactions({ messages, query, userId: req.user.id });
            res.json({ messages });
        } catch (error) {
            logger.error('❌ Get messages error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/chats/:chatId/pinned', async (req, res) => {
        try {
            if (!(await isChatMember(query, req.params.chatId, req.user.id))) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }
            const result = await query(pinnedMessageSql(), [req.params.chatId]);
            res.json({ message: result.rows.length ? mapPinnedMessage(result.rows[0]) : null });
        } catch (error) {
            logger.error('❌ Get pinned message error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

async function loadMessages({ query, req }) {
    const { chatId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const result = await query(messageListSql(), [chatId, parsedLimit, parsedOffset]);
    return result.rows.reverse().map((message) => mapMessage(message, req.user.id));
}

function messageListSql() {
    return `SELECT
                m.id, m.chat_id, m.sender_id, m.content, m.type, m.reply_to_message_id,
                m.is_edited, m.edited_at, m.is_pinned, m.created_at,
                m.media_url, m.media_type, m.voice_duration,
                m.media_encrypted, m.media_encryption,
                m.is_encrypted, m.encryption_iv, m.is_mls, m.mls_epoch,
                COALESCE(read_state.is_read, FALSE) AS is_read,
                u.username as sender_username, u.first_name as sender_first_name, u.avatar_url as sender_avatar,
                u.badge as sender_badge, u.badges as sender_badges, u.is_bot as sender_is_bot,
                u.is_premium as sender_is_premium, u.status_emoji as sender_status_emoji,
                reply.content as reply_to_content,
                reply.is_encrypted as reply_to_encrypted,
                reply.encryption_iv as reply_to_iv,
                reply_user.first_name as reply_to_sender_first_name,
                reply_user.username as reply_to_sender_username
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.id
             LEFT JOIN messages reply ON m.reply_to_message_id = reply.id
             LEFT JOIN users reply_user ON reply.sender_id = reply_user.id
             LEFT JOIN LATERAL (
                SELECT bool_and(ucs.last_read_at IS NOT NULL AND ucs.last_read_at >= m.created_at) AS is_read
                FROM chat_members cm_readers
                LEFT JOIN user_chat_settings ucs
                  ON ucs.chat_id = cm_readers.chat_id
                 AND ucs.user_id = cm_readers.user_id
                WHERE cm_readers.chat_id = m.chat_id
                  AND cm_readers.user_id <> m.sender_id
                  AND cm_readers.joined_at <= m.created_at
             ) read_state ON TRUE
             WHERE m.chat_id = $1 AND m.is_deleted = FALSE
             ORDER BY m.created_at DESC
             LIMIT $2 OFFSET $3`;
}

function mapMessage(message, currentUserId) {
    return {
        id: message.id,
        chatId: message.chat_id,
        senderId: message.sender_id,
        senderUsername: message.sender_username,
        senderFirstName: message.sender_first_name,
        senderAvatar: message.sender_avatar,
        senderBadge: message.sender_badge || null,
        senderBadges: message.sender_badges || [],
        senderIsBot: message.sender_is_bot || false,
        senderIsPremium: message.sender_is_premium || false,
        senderStatusEmoji: message.sender_status_emoji || '',
        content: message.content,
        type: message.media_type || message.type || 'text',
        mediaUrl: message.media_url,
        mediaEncrypted: message.media_encrypted || false,
        mediaEncryption: message.media_encryption || null,
        voiceDuration: message.voice_duration || 0,
        replyToMessageId: message.reply_to_message_id,
        replyToContent: message.reply_to_content,
        replyToEncrypted: message.reply_to_encrypted || false,
        replyToIv: message.reply_to_iv || null,
        replyToSenderName: message.reply_to_sender_first_name || message.reply_to_sender_username,
        isEdited: message.is_edited,
        editedAt: message.edited_at,
        isPinned: message.is_pinned,
        isEncrypted: message.is_encrypted || false,
        encryptionIv: message.encryption_iv || null,
        isMls: message.is_mls || false,
        mlsEpoch: message.mls_epoch || 0,
        isRead: message.sender_id === currentUserId && !!message.is_read,
        createdAt: message.created_at,
    };
}

async function attachReactions({ messages, query, userId }) {
    const messageIds = messages.map((message) => message.id);
    if (messageIds.length === 0) return;

    const result = await query(`
        SELECT mr.message_id, mr.emoji, COUNT(*) as count,
               bool_or(mr.user_id = $2) as my_reaction
        FROM message_reactions mr
        WHERE mr.message_id = ANY($1)
        GROUP BY mr.message_id, mr.emoji
        ORDER BY count DESC
    `, [messageIds, userId]);

    const byMessage = {};
    for (const reaction of result.rows) {
        if (!byMessage[reaction.message_id]) byMessage[reaction.message_id] = [];
        byMessage[reaction.message_id].push({
            emoji: reaction.emoji,
            count: parseInt(reaction.count, 10),
            myReaction: reaction.my_reaction,
        });
    }
    messages.forEach((message) => {
        message.reactions = byMessage[message.id] || [];
    });
}

function pinnedMessageSql() {
    return `SELECT m.*, u.username as sender_username, u.first_name as sender_first_name, u.avatar_url as sender_avatar
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            WHERE m.chat_id = $1 AND m.is_pinned = TRUE
            ORDER BY m.pinned_at DESC
            LIMIT 1`;
}

function mapPinnedMessage(message) {
    return {
        id: message.id,
        chatId: message.chat_id,
        senderId: message.sender_id,
        senderUsername: message.sender_username,
        senderFirstName: message.sender_first_name,
        senderAvatar: message.sender_avatar,
        content: message.content,
        type: message.media_type || message.type,
        mediaUrl: message.media_url,
        mediaEncrypted: message.media_encrypted || false,
        mediaEncryption: message.media_encryption || null,
        isPinned: true,
        pinnedAt: message.pinned_at,
        createdAt: message.created_at,
    };
}

function isChatMember(query, chatId, userId) {
    return query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId])
        .then((result) => result.rows.length > 0);
}

module.exports = createMessageReadRoutes;

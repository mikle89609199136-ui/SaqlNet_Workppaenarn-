const express = require('express');

function createMessageSocialRoutes({ authMiddleware, broadcastToChat, logger, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/favorites', async (req, res) => {
        try {
            const result = await query(favoritesSql(), [req.user.id]);
            res.json({ favorites: result.rows.map(mapFavoriteRow) });
        } catch (error) {
            logger.error('❌ Get favorites error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/:messageId/reactions', async (req, res) => {
        try {
            const { messageId } = req.params;
            const { emoji } = req.body;
            if (!emoji) return res.status(400).json({ error: 'emoji required' });

            const chatId = await getMessageChatId(query, messageId);
            if (!chatId) return res.status(404).json({ error: 'Message not found' });
            if (!(await isChatMember(query, chatId, req.user.id))) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }

            const added = await toggleReaction({ emoji, messageId, query, userId: req.user.id, uuidv4 });
            const reactions = await getReactions(query, messageId, req.user.id);
            broadcastToChat(chatId, { type: 'reaction_updated', messageId, reactions }, null);
            res.json({ success: true, added, reactions });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/:messageId/reactions', async (req, res) => {
        try {
            res.json({ reactions: await getReactions(query, req.params.messageId, req.user.id) });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/:messageId/favorite', async (req, res) => {
        try {
            await query(`
                INSERT INTO favorite_messages (user_id, message_id)
                VALUES ($1, $2)
                ON CONFLICT (user_id, message_id) DO NOTHING
            `, [req.user.id, req.params.messageId]);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/:messageId/favorite', async (req, res) => {
        try {
            await query('DELETE FROM favorite_messages WHERE user_id = $1 AND message_id = $2', [req.user.id, req.params.messageId]);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

function favoritesSql() {
    return `SELECT
                m.id, m.content, m.type, m.media_url, m.media_encrypted, m.media_encryption, m.is_encrypted, m.encryption_iv,
                m.created_at,
                fm.saved_at,
                u.first_name as sender_first_name, u.username as sender_username, u.avatar_url as sender_avatar_url,
                c.title as chat_title, c.name as chat_name, c.type as chat_type,
                m.chat_id
            FROM favorite_messages fm
            JOIN messages m ON fm.message_id = m.id
            JOIN users u ON m.sender_id = u.id
            JOIN chats c ON m.chat_id = c.id
            WHERE fm.user_id = $1
            ORDER BY fm.saved_at DESC
            LIMIT 200`;
}

function mapFavoriteRow(row) {
    return {
        id: row.id,
        content: row.content,
        type: row.type,
        mediaUrl: row.media_url,
        mediaEncrypted: row.media_encrypted || false,
        mediaEncryption: row.media_encryption || null,
        isEncrypted: row.is_encrypted,
        encryptionIv: row.encryption_iv,
        createdAt: row.created_at,
        savedAt: row.saved_at,
        senderFirstName: row.sender_first_name,
        senderUsername: row.sender_username,
        senderAvatarUrl: row.sender_avatar_url,
        chatTitle: row.chat_title,
        chatName: row.chat_name,
        chatId: row.chat_id,
    };
}

async function getMessageChatId(query, messageId) {
    const result = await query('SELECT chat_id FROM messages WHERE id = $1', [messageId]);
    return result.rows[0]?.chat_id || null;
}

function isChatMember(query, chatId, userId) {
    return query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId])
        .then((result) => result.rows.length > 0);
}

async function toggleReaction({ emoji, messageId, query, userId, uuidv4 }) {
    const existing = await query(
        'SELECT id FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
        [messageId, userId, emoji]
    );
    if (existing.rows.length > 0) {
        await query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [messageId, userId, emoji]);
        return false;
    }
    await query(
        'INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [uuidv4(), messageId, userId, emoji]
    );
    return true;
}

async function getReactions(query, messageId, userId) {
    const result = await query(`
        SELECT emoji, COUNT(*) as count,
               bool_or(user_id = $2) as my_reaction,
               array_agg(u.first_name ORDER BY mr.created_at) as users
        FROM message_reactions mr
        JOIN users u ON mr.user_id = u.id
        WHERE mr.message_id = $1
        GROUP BY emoji
        ORDER BY count DESC
    `, [messageId, userId]);
    return result.rows;
}

module.exports = createMessageSocialRoutes;

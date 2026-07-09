const { query } = require('../../../database/database');
const { v4: uuidv4 } = require('uuid');

function assertMessageContent(content) {
    if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('Message content cannot be empty');
    }
}

async function sendMessage(chatId, senderId, content, type = 'text') {
    assertMessageContent(content);

    const messageId = uuidv4();
    await query(
        `INSERT INTO messages (id, chat_id, sender_id, content, type, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [messageId, chatId, senderId, content.trim(), type]
    );
    await query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]);
    return { id: messageId, chatId, senderId, content: content.trim(), type, createdAt: new Date() };
}

async function getMessages(chatId, limit = 50) {
    const result = await query(
        `SELECT m.*, u.username as sender_username, u.first_name as sender_first_name
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE m.chat_id = $1 AND m.is_deleted = FALSE
         ORDER BY m.created_at DESC
         LIMIT $2`,
        [chatId, limit]
    );
    return result.rows.reverse();
}

async function editMessage(messageId, content) {
    assertMessageContent(content);

    const result = await query(
        `UPDATE messages
         SET content = $2, is_edited = TRUE, edited_at = NOW()
         WHERE id = $1 AND is_deleted = FALSE
         RETURNING *`,
        [messageId, content.trim()]
    );

    if (!result.rows[0]) {
        throw new Error('Message not found');
    }

    return result.rows[0];
}

async function deleteMessage(messageId) {
    const result = await query(
        `UPDATE messages
         SET is_deleted = TRUE, deleted_at = NOW()
         WHERE id = $1 AND is_deleted = FALSE
         RETURNING id`,
        [messageId]
    );

    if (!result.rows[0]) {
        throw new Error('Message not found');
    }

    return true;
}

async function markAsRead(messageIds, userId) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
        throw new Error('Message IDs are required');
    }

    const result = await query(
        `SELECT chat_id, MAX(created_at) AS last_read_at
         FROM messages
         WHERE id = ANY($1::uuid[])
         GROUP BY chat_id`,
        [messageIds]
    );

    await Promise.all(result.rows.map((row) => query(
        `INSERT INTO user_chat_settings (user_id, chat_id, last_read_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, chat_id)
         DO UPDATE SET last_read_at = EXCLUDED.last_read_at`,
        [userId, row.chat_id, row.last_read_at]
    )));

    return true;
}

async function forwardMessage(messageId, chatId, senderId) {
    const original = await query(
        'SELECT sender_id, content, type FROM messages WHERE id = $1 AND is_deleted = FALSE',
        [messageId]
    );

    if (!original.rows[0]) {
        throw new Error('Message not found');
    }

    const forwardedMessageId = uuidv4();
    const message = original.rows[0];
    const result = await query(
        `INSERT INTO messages (id, chat_id, sender_id, content, type, forwarded_from, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [forwardedMessageId, chatId, senderId, message.content, message.type, messageId]
    );

    await query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]);
    return result.rows[0];
}

async function pinMessage(messageId) {
    const result = await query(
        `UPDATE messages
         SET is_pinned = TRUE, pinned_at = NOW()
         WHERE id = $1 AND is_deleted = FALSE
         RETURNING id`,
        [messageId]
    );

    if (!result.rows[0]) {
        throw new Error('Message not found');
    }

    return true;
}

async function reactToMessage(messageId, userId, emoji) {
    if (!emoji) {
        throw new Error('Emoji is required');
    }

    await query(
        `INSERT INTO reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
        [messageId, userId, emoji]
    );

    return true;
}

module.exports = {
    sendMessage,
    getMessages,
    editMessage,
    deleteMessage,
    markAsRead,
    forwardMessage,
    pinMessage,
    reactToMessage
};

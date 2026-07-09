const { query } = require('../../../database/database');
const { v4: uuidv4 } = require('uuid');

async function getChats(userId) {
    const result = await query(
        `SELECT c.*, cm.role,
                (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.is_deleted = FALSE) as message_count,
                (SELECT MAX(created_at) FROM messages m WHERE m.chat_id = c.id) as last_message_at
         FROM chats c
         JOIN chat_members cm ON c.id = cm.chat_id
         WHERE cm.user_id = $1
         ORDER BY last_message_at DESC NULLS LAST`,
        [userId]
    );
    return result.rows;
}

async function getChat(chatId) {
    const result = await query('SELECT * FROM chats WHERE id = $1', [chatId]);
    return result.rows[0];
}

async function createChat(userId, type, participants = [], title = '', extra = {}) {
    const chatId = uuidv4();
    const { username, description, avatar_url, allowed_reactions, is_public } = extra;

    await query(
        `INSERT INTO chats (id, type, title, name, username, description, avatar_url, owner_id, allowed_reactions, is_public)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [chatId, type, title, title, username, description || '', avatar_url || '', userId, JSON.stringify(allowed_reactions || []), is_public !== false]
    );

    await query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [chatId, userId]
    );

    for (const pId of participants) {
        if (pId !== userId) {
            await query(
                `INSERT INTO chat_members (chat_id, user_id, role)
                 VALUES ($1, $2, 'member')`,
                [chatId, pId]
            );
        }
    }

    return { id: chatId, type, title };
}

async function updateChat(chatId, updates) {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
        if (['title', 'name', 'description', 'avatar_url', 'username', 'is_public', 'allowed_reactions'].includes(key)) {
            fields.push(`${key} = $${idx++}`);
            values.push(key === 'allowed_reactions' ? JSON.stringify(value) : value);
        }
    }

    if (fields.length === 0) return null;

    values.push(chatId);
    const result = await query(
        `UPDATE chats SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} RETURNING *`,
        values
    );
    return result.rows[0];
}

async function deleteChat(chatId) {
    await query('DELETE FROM chats WHERE id = $1', [chatId]);
}

async function muteChat(chatId, duration) {
    // Placeholder: mute duration storage depends on schema extension.
    void duration;
}

async function pinChat(chatId) {
    await query('UPDATE chats SET is_pinned = TRUE, pinned_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);
}

async function archiveChat(chatId) {
    await query('UPDATE chats SET is_archived = TRUE, archived_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);
}

async function getChatMembers(chatId) {
    const result = await query(
        `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, cm.role
         FROM chat_members cm
         JOIN users u ON cm.user_id = u.id
         WHERE cm.chat_id = $1`,
        [chatId]
    );
    return result.rows;
}

const getUserChats = getChats;

module.exports = {
    getChats,
    getUserChats,
    getChat,
    createChat,
    updateChat,
    deleteChat,
    muteChat,
    pinChat,
    archiveChat,
    getChatMembers
};

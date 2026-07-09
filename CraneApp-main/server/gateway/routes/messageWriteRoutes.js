const express = require('express');

const MEDIA_MESSAGE_TYPES = new Set(['image', 'video', 'audio', 'voice', 'file', 'gif', 'sticker']);
const MAX_MESSAGE_LENGTH = 64_000;

function createMessageWriteRoutes({ authMiddleware, broadcastToChat, handleBotCommand, logger, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.post('/:chatId', async (req, res) => {
        try {
            if (req.user.is_muted) return sendMutedError(req, res);

            const memberRes = await query('SELECT role, muted_until FROM chat_members WHERE chat_id = $1 AND user_id = $2', [req.params.chatId, req.user.id]);
            if (memberRes.rows.length === 0) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }
            const member = memberRes.rows[0];
            if (member.role === 'member' && member.muted_until && new Date(member.muted_until) > new Date()) {
                return res.status(403).json({ error: req.t('mutedCannotSend') || 'You are muted in this group' });
            }

            await validateReply(query, req);

            const message = await insertMessage({ query, req, uuidv4 });
            const chatInfo = await query('SELECT type, title FROM chats WHERE id = $1', [req.params.chatId]);
            const chatType = chatInfo.rows[0]?.type || 'private';
            const chatTitle = chatInfo.rows[0]?.title || null;

            broadcastToChat(req.params.chatId, { type: 'new_message', chatId: req.params.chatId, chatType, chatTitle, message: redactForBroadcast(message) }, req.user.id);
            await maybeHandleBotCommand({ broadcastToChat, chatType, handleBotCommand, logger, query, req, uuidv4 });

            logger.info('✅ Message sent:', message.id);
            res.status(201).json({ message });
        } catch (error) {
            logger.error('❌ Send message error:', error);
            res.status(error.status || 500).json({ error: error.message });
        }
    });

    router.put('/:messageId', async (req, res) => {
        try {
            if (!req.body.content || req.body.content.trim().length === 0) {
                return res.status(400).json({ error: 'Message content required' });
            }
            if (req.body.content.length > MAX_MESSAGE_LENGTH) {
                return res.status(400).json({ error: 'Message too long' });
            }
            const message = await getMessageOwner(query, req.params.messageId);
            if (!message) return res.status(404).json({ error: 'Message not found' });
            if (message.sender_id !== req.user.id) return res.status(403).json({ error: 'Cannot edit someone else message' });

            await query('UPDATE messages SET content = $1, is_edited = TRUE, edited_at = NOW() WHERE id = $2', [req.body.content, req.params.messageId]);
            broadcastToChat(message.chat_id, { type: 'message_edited', messageId: req.params.messageId, content: req.body.content, editedAt: new Date() });
            logger.info('✅ Message edited:', req.params.messageId);
            res.json({ success: true, content: req.body.content, editedAt: new Date() });
        } catch (error) {
            logger.error('❌ Edit message error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/:messageId', async (req, res) => {
        try {
            const message = await getMessageOwner(query, req.params.messageId);
            if (!message) return res.status(404).json({ error: 'Message not found' });
            const forEveryone = req.query.forEveryone === 'true';
            if (forEveryone && message.sender_id !== req.user.id) {
                const memberRes = await query('SELECT role, permissions FROM chat_members WHERE chat_id = $1 AND user_id = $2', [message.chat_id, req.user.id]);
                if (memberRes.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
                const mem = memberRes.rows[0];
                const perms = typeof mem.permissions === 'string' ? JSON.parse(mem.permissions) : (mem.permissions || {});
                
                const isAuthorized = mem.role === 'owner' || (mem.role === 'admin' && perms.can_delete_messages === true);
                if (!isAuthorized) {
                    return res.status(403).json({ error: 'Only sender or admins with can_delete_messages can delete messages for everyone' });
                }
            }

            await query('UPDATE messages SET is_deleted = TRUE WHERE id = $1', [req.params.messageId]);
            broadcastToChat(message.chat_id, { type: 'message_deleted', messageId: req.params.messageId, chatId: message.chat_id, forEveryone });
            logger.info('✅ Message deleted:', req.params.messageId);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Delete message error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/:messageId/pin', async (req, res) => {
        try {
            const message = await pinMessage({ query, req });
            broadcastToChat(message.chatId, { type: 'message_pinned', chatId: message.chatId, message }, req.user.id);
            logger.info('✅ Message pinned:', req.params.messageId);
            res.json({ success: true, isPinned: true, message });
        } catch (error) {
            logger.error('❌ Pin message error:', error);
            res.status(error.status || 500).json({ error: error.message });
        }
    });

    router.delete('/:messageId/pin', async (req, res) => {
        try {
            const message = await getMessageIdAndChat(query, req.params.messageId);
            if (!message) return res.status(404).json({ error: 'Message not found' });

            const memberRes = await query('SELECT role, permissions FROM chat_members WHERE chat_id = $1 AND user_id = $2', [message.chat_id, req.user.id]);
            if (!memberRes.rows.length) return res.status(403).json({ error: req.t('accessDenied') });
            const mem = memberRes.rows[0];

            const chat = await query('SELECT type FROM chats WHERE id = $1', [message.chat_id]);
            const isGroup = chat.rows[0]?.type === 'group' || chat.rows[0]?.type === 'channel';
            if (isGroup) {
                const perms = typeof mem.permissions === 'string' ? JSON.parse(mem.permissions) : (mem.permissions || {});
                if (mem.role === 'member') return res.status(403).json({ error: 'Only admins can unpin messages' });
                if (mem.role === 'admin' && perms.can_pin_messages !== true) {
                    return res.status(403).json({ error: 'Missing permission: can_pin_messages' });
                }
            }

            await query('UPDATE messages SET is_pinned = FALSE, pinned_at = NULL WHERE id = $1', [req.params.messageId]);
            broadcastToChat(message.chat_id, { type: 'message_unpinned', messageId: req.params.messageId, chatId: message.chat_id });
            logger.info('✅ Message unpinned:', req.params.messageId);
            res.json({ success: true, isPinned: false });
        } catch (error) {
            logger.error('❌ Unpin message error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

// For encrypted messages: strip content_plain from WebSocket broadcast to prevent
// server-side plaintext exposure to connected clients that shouldn't see it
function redactForBroadcast(message) {
    if (!message.isEncrypted && !message.isMls) return message;
    const { contentPlain: _omit, ...safe } = message;
    return safe;
}

function sendMutedError(req, res) {
    const error = req.user.mute_reason
        ? req.t('mutedReason', { reason: req.user.mute_reason })
        : req.t('mutedCannotSend');
    return res.status(403).json({ error });
}

async function validateReply(query, req) {
    if (!req.body.replyTo) return;
    const result = await query(
        'SELECT id FROM messages WHERE id = $1 AND chat_id = $2 AND is_deleted = FALSE',
        [req.body.replyTo, req.params.chatId]
    );
    if (result.rows.length === 0) {
        const error = new Error(req.t('replyNotFound'));
        error.status = 400;
        throw error;
    }
}

async function insertMessage({ query, req, uuidv4 }) {
    const { content, type = 'text', replyTo, mediaUrl, mediaType, forwardFrom, voiceDuration, mediaEncrypted, mediaEncryption } = req.body;
    const { iv: encryptionIv, isEncrypted, contentPlain, isMls, mlsEpoch } = req.body;

    if (content && content.length > MAX_MESSAGE_LENGTH) {
        throw statusError('Message too long', 400);
    }

    const messageId = uuidv4();
    const messageType = mediaType || type;
    if (mediaUrl && MEDIA_MESSAGE_TYPES.has(messageType) && mediaEncrypted !== true) {
        throw statusError('Message media must be encrypted', 400);
    }
    const messageContent = forwardFrom
        ? '↪️ ' + req.t('forwardedFrom', { name: forwardFrom }) + ':\n' + (content || '')
        : (content || '');
    const plainText = isEncrypted ? (contentPlain || '') : messageContent;

    await query(
        `INSERT INTO messages (id, chat_id, sender_id, content, content_plain, type, reply_to_message_id, media_url, media_type, voice_duration, is_encrypted, encryption_iv, is_mls, mls_epoch, media_encrypted, media_encryption, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
        [messageId, req.params.chatId, req.user.id, messageContent, plainText, type, replyTo || null, mediaUrl || null, mediaType || null, voiceDuration || 0, isEncrypted || false, encryptionIv || null, isMls || false, mlsEpoch || 0, mediaEncrypted || false, mediaEncryption || null]
    );

    return {
        id: messageId,
        chatId: req.params.chatId,
        senderId: req.user.id,
        sender: mapSender(req.user),
        content: messageContent,
        type: messageType,
        mediaUrl,
        mediaEncrypted: mediaEncrypted || false,
        mediaEncryption: mediaEncryption || null,
        voiceDuration: voiceDuration || 0,
        replyToMessageId: replyTo,
        replyToData: replyTo ? await loadReplyData(query, replyTo) : null,
        forwardFrom: forwardFrom || null,
        isEncrypted: isEncrypted || false,
        encryptionIv: encryptionIv || null,
        isMls: isMls || false,
        mlsEpoch: mlsEpoch || 0,
        createdAt: new Date(),
    };
}

function mapSender(user) {
    return {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        avatarUrl: user.avatar_url,
        badge: user.badge || null,
        isBot: user.is_bot || false,
    };
}

async function loadReplyData(query, replyTo) {
    const result = await query(
        `SELECT m.content, m.is_encrypted, m.encryption_iv, m.is_mls, m.mls_epoch, u.first_name, u.username
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE m.id = $1`,
        [replyTo]
    );
    if (!result.rows.length) return null;
    const reply = result.rows[0];
    return {
        messageId: replyTo,
        content: reply.content,
        isEncrypted: reply.is_encrypted || false,
        encryptionIv: reply.encryption_iv || null,
        isMls: reply.is_mls || false,
        mlsEpoch: reply.mls_epoch || 0,
        senderName: reply.first_name || reply.username,
    };
}

async function maybeHandleBotCommand({ broadcastToChat, chatType, handleBotCommand, logger, query, req, uuidv4 }) {
    try {
        const bot = await query("SELECT id FROM users WHERE username = 'craneapp_bot'");
        if (!bot.rows.length) return;
        const botId = bot.rows[0].id;
        if (!(await isChatMember(query, req.params.chatId, botId))) return;

        const chat = await query('SELECT type FROM chats WHERE id = $1', [req.params.chatId]);
        if (chat.rows[0]?.type !== 'private') return;

        const botReply = await handleBotCommand(req.body.content || '', req.user.id, botId, req.params.chatId, req.locale);
        if (!botReply) return;

        const botMsgId = uuidv4();
        await query(
            "INSERT INTO messages (id, chat_id, sender_id, content, type, created_at) VALUES ($1, $2, $3, $4, 'text', NOW())",
            [botMsgId, req.params.chatId, botId, botReply]
        );
        const botMessage = { id: botMsgId, chatId: req.params.chatId, senderId: botId, content: botReply, type: 'text', createdAt: new Date() };
        broadcastToChat(req.params.chatId, { type: 'new_message', chatId: req.params.chatId, chatType, message: botMessage }, null);
    } catch (error) {
        logger.error('❌ Bot command error:', error.message, error.stack);
    }
}

async function pinMessage({ query, req }) {
    const message = await getMessageIdAndChat(query, req.params.messageId);
    if (!message) throw statusError('Message not found', 404);

    const member = await query('SELECT role, permissions FROM chat_members WHERE chat_id = $1 AND user_id = $2', [message.chat_id, req.user.id]);
    if (!member.rows.length) throw statusError(req.t('accessDenied'), 403);

    const chat = await query('SELECT type FROM chats WHERE id = $1', [message.chat_id]);
    const isGroup = chat.rows[0]?.type === 'group' || chat.rows[0]?.type === 'channel';
    if (isGroup) {
        const mem = member.rows[0];
        const perms = typeof mem.permissions === 'string' ? JSON.parse(mem.permissions) : (mem.permissions || {});
        if (mem.role === 'member') throw statusError(req.t('adminsPinOnly') || 'Only admins can pin messages', 403);
        if (mem.role === 'admin' && perms.can_pin_messages !== true) {
            throw statusError('Missing permission: can_pin_messages', 403);
        }
    }

    await query('UPDATE messages SET is_pinned = FALSE, pinned_at = NULL WHERE chat_id = $1 AND is_pinned = TRUE', [message.chat_id]);
    await query('UPDATE messages SET is_pinned = TRUE, pinned_at = NOW() WHERE id = $1', [req.params.messageId]);
    const result = await query(
        `SELECT m.*, u.username as sender_username, u.first_name as sender_first_name
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE m.id = $1`,
        [req.params.messageId]
    );
    return mapPinnedMessage(result.rows[0]);
}

function mapPinnedMessage(message) {
    return {
        id: message.id,
        chatId: message.chat_id,
        senderId: message.sender_id,
        senderUsername: message.sender_username,
        senderFirstName: message.sender_first_name,
        content: message.content,
        type: message.media_type || message.type,
        mediaUrl: message.media_url,
        mediaEncrypted: message.media_encrypted || false,
        mediaEncryption: message.media_encryption || null,
        isPinned: true,
        createdAt: message.created_at,
    };
}

function statusError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function getMessageOwner(query, messageId) {
    return query('SELECT sender_id, chat_id FROM messages WHERE id = $1', [messageId])
        .then((result) => result.rows[0] || null);
}

function getMessageIdAndChat(query, messageId) {
    return query('SELECT id, chat_id FROM messages WHERE id = $1', [messageId])
        .then((result) => result.rows[0] || null);
}

function isChatMember(query, chatId, userId) {
    return query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId])
        .then((result) => result.rows.length > 0);
}

module.exports = createMessageWriteRoutes;

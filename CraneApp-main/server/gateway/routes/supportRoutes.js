const express = require('express');

function createSupportRoutes({
    authMiddleware,
    broadcastToChat,
    isDeveloper,
    logger,
    query,
    uuidv4,
}) {
    const router = express.Router();

    router.use(authMiddleware);
    router.use((req, res, next) => {
        if (!isDeveloper(req.user.username)) {
            return res.status(403).json({ error: req.t('accessDenied') });
        }
        next();
    });

    router.get('/requests', async (req, res) => {
        try {
            const result = await query(`
                SELECT sr.id, sr.message, sr.status, sr.created_at,
                       u.id as user_id, u.username, u.first_name, u.last_name, u.avatar_url, u.badges,
                       sr.chat_id
                FROM support_requests sr
                JOIN users u ON sr.user_id = u.id
                ORDER BY sr.created_at DESC
                LIMIT 100
            `);
            res.json({ requests: result.rows });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.put('/requests/:id', async (req, res) => {
        try {
            const { status } = req.body;
            await query('UPDATE support_requests SET status = $1 WHERE id = $2', [status, req.params.id]);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/requests/:id/reply', async (req, res) => {
        try {
            const { message } = req.body;
            if (!message) return res.status(400).json({ error: req.t('messageRequired') });

            const supportRequest = await findSupportRequest(query, req.params.id);
            if (!supportRequest) return res.status(404).json({ error: req.t('requestNotFound') });
            if (supportRequest.status === 'closed') {
                return res.status(400).json({ error: req.t('supportRequestClosed') });
            }

            const botId = await findBotId(query);
            if (!botId) return res.status(500).json({ error: req.t('botNotFound') });

            const targetChatId = await findBotChatId(query, supportRequest.user_id, botId);
            if (!targetChatId) return res.status(404).json({ error: 'User bot chat not found' });

            const messageId = uuidv4();
            await query(
                `INSERT INTO messages (id, chat_id, sender_id, content, type, created_at)
                 VALUES ($1, $2, $3, $4, 'text', NOW())`,
                [messageId, targetChatId, botId, message]
            );

            broadcastToChat(targetChatId, {
                type: 'new_message',
                chatId: targetChatId,
                message: {
                    id: messageId,
                    senderId: botId,
                    content: message,
                    type: 'text',
                    createdAt: new Date(),
                },
            }, null);

            await query('UPDATE support_requests SET status = $1 WHERE id = $2', ['closed', req.params.id]);
            res.json({ success: true, chatId: targetChatId });
        } catch (error) {
            logger.error('Support reply error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/requests/:id/messages', async (req, res) => {
        try {
            const supportRequest = await findSupportRequest(query, req.params.id);
            if (!supportRequest) return res.status(404).json({ error: 'Not found' });

            const botId = await findBotId(query);
            if (!botId) return res.status(404).json({ error: 'Bot not found' });

            const chatId = await findBotChatId(query, supportRequest.user_id, botId);
            if (!chatId) return res.json({ messages: [], chatId: null });

            const messages = await query(
                `SELECT m.id, m.content, m.type, m.created_at, m.sender_id,
                        u.first_name, u.username, u.is_bot
                 FROM messages m
                 JOIN users u ON m.sender_id = u.id
                 WHERE m.chat_id = $1 AND m.is_deleted = FALSE
                 ORDER BY m.created_at ASC LIMIT 100`,
                [chatId]
            );
            const userInfo = await query(
                'SELECT first_name, username, avatar_url FROM users WHERE id = $1',
                [supportRequest.user_id]
            );

            res.json({
                messages: messages.rows,
                chatId,
                userId: supportRequest.user_id,
                requestId: req.params.id,
                status: supportRequest.status,
                user: userInfo.rows[0] || {},
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

async function findSupportRequest(query, requestId) {
    const result = await query('SELECT * FROM support_requests WHERE id = $1', [requestId]);
    return result.rows[0] || null;
}

async function findBotId(query) {
    const result = await query("SELECT id FROM users WHERE username = 'craneapp_bot'");
    return result.rows[0]?.id || null;
}

async function findBotChatId(query, userId, botId) {
    const result = await query(
        `SELECT c.id FROM chats c
         JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = $1
         JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = $2
         WHERE c.type = 'private' LIMIT 1`,
        [userId, botId]
    );
    return result.rows[0]?.id || null;
}

module.exports = createSupportRoutes;

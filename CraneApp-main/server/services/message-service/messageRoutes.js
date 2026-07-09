const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middleware/authMiddleware');
const messageService = require('./messageService');

router.post('/:chatId', authMiddleware, async (req, res) => {
    try {
        const { chatId } = req.params;
        const { content, type = 'text' } = req.body;
        const userId = req.user.id || req.user.userId;
        const message = await messageService.sendMessage(chatId, userId, content, type);
        
        // WebSocket рассылка
        global.wss?.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(JSON.stringify({ type: 'new_message', chatId, message: { ...message, sender: req.user } }));
            }
        });

        res.status(201).json({ success: true, message });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/:chatId', authMiddleware, async (req, res) => {
    try {
        const { chatId } = req.params;
        const { limit = 50 } = req.query;
        const messages = await messageService.getMessages(chatId, parseInt(limit));
        res.status(200).json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

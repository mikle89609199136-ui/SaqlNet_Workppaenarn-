const express = require('express');
const router = express.Router();
const authMiddleware = require('../../gateway/authMiddleware');
const chatController = require('./chatController');
const chatService = require('./chatService');

router.get('/', authMiddleware, chatController.getChats);
router.post('/', authMiddleware, chatController.createChat);
router.get('/:chatId/members', authMiddleware, async (req, res) => {
    try {
        const members = await chatService.getChatMembers(req.params.chatId);
        res.status(200).json({ success: true, members });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
router.get('/:id', authMiddleware, chatController.getChat);
router.put('/:id', authMiddleware, chatController.updateChat);
router.delete('/:id', authMiddleware, chatController.deleteChat);

router.post('/:id/mute', authMiddleware, chatController.muteChat);
router.post('/:id/pin', authMiddleware, chatController.pinChat);
router.post('/:id/archive', authMiddleware, chatController.archiveChat);

module.exports = router;

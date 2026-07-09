const messageService = require('./messageService');
const logger = require('../logger');

const getMessages = async (req, res) => {
  try {
    const { chatId } = req.query;
    const messages = await messageService.getMessages(chatId);

    res.status(200).json({
      success: true,
      messages
    });
  } catch (error) {
    logger.error('Get messages controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get messages',
      message: error.message
    });
  }
};

const sendMessage = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { chatId, content, type } = req.body;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const message = await messageService.sendMessage(chatId, userId, content, type);

    res.status(200).json({
      success: true,
      message
    });
  } catch (error) {
    logger.error('Send message controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to send message',
      message: error.message
    });
  }
};

const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    const message = await messageService.editMessage(id, content);

    res.status(200).json({
      success: true,
      message
    });
  } catch (error) {
    logger.error('Edit message controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to edit message',
      message: error.message
    });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    await messageService.deleteMessage(id);

    res.status(200).json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error) {
    logger.error('Delete message controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to delete message',
      message: error.message
    });
  }
};

const markAsRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { messageIds } = req.body;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    await messageService.markAsRead(messageIds, userId);

    res.status(200).json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    logger.error('Mark as read controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to mark as read',
      message: error.message
    });
  }
};

const forwardMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || req.user?.userId;
    const { chatId } = req.body;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const message = await messageService.forwardMessage(id, chatId, userId);

    res.status(200).json({
      success: true,
      message
    });
  } catch (error) {
    logger.error('Forward message controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to forward message',
      message: error.message
    });
  }
};

const pinMessage = async (req, res) => {
  try {
    const { id } = req.params;
    await messageService.pinMessage(id);

    res.status(200).json({
      success: true,
      message: 'Message pinned'
    });
  } catch (error) {
    logger.error('Pin message controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to pin message',
      message: error.message
    });
  }
};

const reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || req.user?.userId;
    const { emoji } = req.body;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    await messageService.reactToMessage(id, userId, emoji);

    res.status(200).json({
      success: true,
      message: 'Reaction added'
    });
  } catch (error) {
    logger.error('React to message controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to add reaction',
      message: error.message
    });
  }
};

module.exports = {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  markAsRead,
  forwardMessage,
  pinMessage,
  reactToMessage
};

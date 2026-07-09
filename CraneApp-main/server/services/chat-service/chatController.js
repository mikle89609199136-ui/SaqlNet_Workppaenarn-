const chatService = require('./chatService');
const logger = require('../logger');

const createChat = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { type, participants, title, ...extra } = req.body;

    const chat = await chatService.createChat(userId, type, participants, title, extra);

    res.status(200).json({
      success: true,
      chat
    });
  } catch (error) {
    logger.error('Create chat controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to create chat',
      message: error.message
    });
  }
};

const getChats = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const chats = await chatService.getChats(userId);

    res.status(200).json({
      success: true,
      chats
    });
  } catch (error) {
    logger.error('Get chats controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get chats',
      message: error.message
    });
  }
};

const getChat = async (req, res) => {
  try {
    const { id } = req.params;
    const chat = await chatService.getChat(id);

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found'
      });
    }

    res.status(200).json({
      success: true,
      chat
    });
  } catch (error) {
    logger.error('Get chat controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get chat',
      message: error.message
    });
  }
};

const updateChat = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const chat = await chatService.updateChat(id, updates);

    res.status(200).json({
      success: true,
      chat
    });
  } catch (error) {
    logger.error('Update chat controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to update chat',
      message: error.message
    });
  }
};

const deleteChat = async (req, res) => {
  try {
    const { id } = req.params;
    await chatService.deleteChat(id);

    res.status(200).json({
      success: true,
      message: 'Chat deleted successfully'
    });
  } catch (error) {
    logger.error('Delete chat controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to delete chat',
      message: error.message
    });
  }
};

const muteChat = async (req, res) => {
  try {
    const { id } = req.params;
    const { duration } = req.body;

    await chatService.muteChat(id, duration);

    res.status(200).json({
      success: true,
      message: 'Chat muted'
    });
  } catch (error) {
    logger.error('Mute chat controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to mute chat',
      message: error.message
    });
  }
};

const pinChat = async (req, res) => {
  try {
    const { id } = req.params;
    await chatService.pinChat(id);

    res.status(200).json({
      success: true,
      message: 'Chat pinned'
    });
  } catch (error) {
    logger.error('Pin chat controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to pin chat',
      message: error.message
    });
  }
};

const archiveChat = async (req, res) => {
  try {
    const { id } = req.params;
    await chatService.archiveChat(id);

    res.status(200).json({
      success: true,
      message: 'Chat archived'
    });
  } catch (error) {
    logger.error('Archive chat controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to archive chat',
      message: error.message
    });
  }
};

module.exports = {
  createChat,
  getChats,
  getChat,
  updateChat,
  deleteChat,
  muteChat,
  pinChat,
  archiveChat
};
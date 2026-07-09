const storageService = require('./storageService');
const logger = require('../logger');
const path = require('path');

/**
 * Upload single media file
 */
const uploadMedia = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { chatId, type } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const media = await storageService.saveFile(file, userId, chatId, type);

    res.status(200).json({
      success: true,
      media
    });
  } catch (error) {
    logger.error('Upload media controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload media',
      message: error.message
    });
  }
};

/**
 * Upload multiple media files
 */
const uploadMultipleMedia = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { chatId, type } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    const media = [];
    for (const file of files) {
      const saved = await storageService.saveFile(file, userId, chatId, type);
      media.push(saved);
    }

    res.status(200).json({
      success: true,
      media
    });
  } catch (error) {
    logger.error('Upload multiple media controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload media',
      message: error.message
    });
  }
};

/**
 * Get media by ID
 */
const getMedia = async (req, res) => {
  try {
    const { mediaId } = req.params;

    const media = await storageService.getMedia(mediaId);

    if (!media) {
      return res.status(404).json({
        success: false,
        error: 'Media not found'
      });
    }

    res.status(200).json({
      success: true,
      media
    });
  } catch (error) {
    logger.error('Get media controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get media',
      message: error.message
    });
  }
};

/**
 * Delete media by ID
 */
const deleteMedia = async (req, res) => {
  try {
    const { mediaId } = req.params;
    const userId = req.user.userId;

    await storageService.deleteMedia(mediaId, userId);

    res.status(200).json({
      success: true,
      message: 'Media deleted successfully'
    });
  } catch (error) {
    logger.error('Delete media controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete media',
      message: error.message
    });
  }
};

/**
 * Get all media for a chat
 */
const getChatMedia = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const media = await storageService.getChatMedia(chatId, parseInt(limit), parseInt(offset));

    res.status(200).json({
      success: true,
      media
    });
  } catch (error) {
    logger.error('Get chat media controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get chat media',
      message: error.message
    });
  }
};

module.exports = {
  uploadMedia,
  uploadMultipleMedia,
  getMedia,
  deleteMedia,
  getChatMedia
};
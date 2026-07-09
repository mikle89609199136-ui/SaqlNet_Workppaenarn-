const userService = require('./users');
const logger = require('../logger');

/**
 * Get current user profile
 */
const getMe = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await userService.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        status: 404
      });
    }

    // Fetch user settings to include language
    const settings = await userService.getAllSettings(userId);
    const language = settings.language || 'ru';

    res.status(200).json({
      success: true,
      user: {
        ...user,
        language
      }
    });
  } catch (error) {
    logger.error('Get me controller error:', error);
    res.status(500).json({
      error: 'Failed to get user profile',
      message: error.message,
      status: 500
    });
  }
};

/**
 * Update user profile
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { firstName, lastName, username, bio, avatarUrl } = req.body;
    
    const user = await userService.updateUserProfile(userId, {
      firstName,
      lastName,
      username,
      bio,
      avatarUrl
    });
    
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
       user
    });
  } catch (error) {
    logger.error('Update profile controller error:', error);
    res.status(400).json({
      error: 'Failed to update profile',
      message: error.message,
      status: 400
    });
  }
};

/**
 * Get user by ID
 */
const getUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await userService.getUserById(id);
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        status: 404
      });
    }
    
    res.status(200).json({
      success: true,
       user
    });
  } catch (error) {
    logger.error('Get user controller error:', error);
    res.status(500).json({
      error: 'Failed to get user',
      message: error.message,
      status: 500
    });
  }
};

/**
 * Get user contacts
 */
const getContacts = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const contacts = await userService.getUserContacts(userId);
    
    res.status(200).json({
      success: true,
       contacts
    });
  } catch (error) {
    logger.error('Get contacts controller error:', error);
    res.status(500).json({
      error: 'Failed to get contacts',
      message: error.message,
      status: 500
    });
  }
};

/**
 * Add contact
 */
const addContact = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { contactUserId } = req.body;
    
    await userService.addContact(userId, contactUserId);
    
    res.status(200).json({
      success: true,
      message: 'Contact added successfully'
    });
  } catch (error) {
    logger.error('Add contact controller error:', error);
    res.status(400).json({
      error: 'Failed to add contact',
      message: error.message,
      status: 400
    });
  }
};

/**
 * Block user
 */
const blockUser = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { blockedUserId } = req.body;
    
    await userService.blockUser(userId, blockedUserId);
    
    res.status(200).json({
      success: true,
      message: 'User blocked successfully'
    });
  } catch (error) {
    logger.error('Block user controller error:', error);
    res.status(400).json({
      error: 'Failed to block user',
      message: error.message,
      status: 400
    });
  }
};

/**
 * Unblock user
 */
const unblockUser = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { blockedUserId } = req.body;
    
    await userService.unblockUser(userId, blockedUserId);
    
    res.status(200).json({
      success: true,
      message: 'User unblocked successfully'
    });
  } catch (error) {
    logger.error('Unblock user controller error:', error);
    res.status(400).json({
      error: 'Failed to unblock user',
      message: error.message,
      status: 400
    });
  }
};

/**
 * Get blocked users
 */
const getBlockedUsers = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const users = await userService.getBlockedUsers(userId);
    
    res.status(200).json({
      success: true,
       users
    });
  } catch (error) {
    logger.error('Get blocked users controller error:', error);
    res.status(500).json({
      error: 'Failed to get blocked users',
      message: error.message,
      status: 500
    });
  }
};

/**
 * Search users
 */
const searchUsers = async (req, res) => {
  try {
    const { q, limit } = req.query;
    
    if (!q) {
      return res.status(400).json({
        error: 'Search query is required',
        status: 400
      });
    }
    
    const users = await userService.searchUsers(q, parseInt(limit) || 20);
    
    res.status(200).json({
      success: true,
       users
    });
  } catch (error) {
    logger.error('Search users controller error:', error);
    res.status(500).json({
      error: 'Failed to search users',
      message: error.message,
      status: 500
    });
  }
};

/**
 * Get all user settings
 */
const getAllSettings = async (req, res) => {
  try {
    const userId = req.user.userId;

    const settings = await userService.getAllSettings(userId);

    res.status(200).json({
      success: true,
      settings
    });
  } catch (error) {
    logger.error('Get all settings controller error:', error);
    res.status(500).json({
      error: 'Failed to get settings',
      message: error.message,
      status: 500
    });
  }
};

/**
 * Update all user settings
 */
const updateAllSettings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { settings } = req.body;

    if (!settings) {
      return res.status(400).json({
        error: 'Settings are required',
        status: 400
      });
    }

    const updatedSettings = await userService.updateAllSettings(userId, settings);

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      settings: updatedSettings
    });
  } catch (error) {
    logger.error('Update all settings controller error:', error);
    res.status(400).json({
      error: 'Failed to update settings',
      message: error.message,
      status: 400
    });
  }
};

/**
 * Delete account
 */
const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.userId;

    await userService.deleteUser(userId);

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    logger.error('Delete account controller error:', error);
    res.status(400).json({
      error: 'Failed to delete account',
      message: error.message,
      status: 400
    });
  }
};

module.exports = {
  getMe,
  updateProfile,
  getUser,
  getContacts,
  addContact,
  blockUser,
  unblockUser,
  getBlockedUsers,
  searchUsers,
  deleteAccount,
  getAllSettings,
  updateAllSettings
};
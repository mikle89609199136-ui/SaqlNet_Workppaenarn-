const { query } = require('../../../database/database');
const logger = require('../logger');
const bcrypt = require('bcrypt');

/**
 * User Service
 * All user-related database operations
 */

/**
 * Get user by ID
 */
async function getUserById(userId) {
  try {
    const result = await query(
      'SELECT id, phone, username, first_name, last_name, avatar_url, bio, is_bot, is_premium, language, last_seen, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Get user by ID error:', error);
    throw new Error('Failed to get user');
  }
}

/**
 * Get user by phone
 */
async function getUserByPhone(phone) {
  try {
    const result = await query(
      'SELECT id, phone, username, first_name, last_name, avatar_url, bio, is_bot, is_premium, language, last_seen, created_at FROM users WHERE phone = $1',
      [phone]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Get user by phone error:', error);
    throw new Error('Failed to get user');
  }
}

/**
 * Get user by username
 */
async function getUserByUsername(username) {
  try {
    const result = await query(
      'SELECT id, phone, username, first_name, last_name, avatar_url, bio, is_bot, is_premium, language, last_seen, created_at FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Get user by username error:', error);
    throw new Error('Failed to get user');
  }
}

/**
 * Create new user
 */
async function createUser(phone, firstName = null, lastName = null, username = null) {
  try {
    const result = await query(
      `INSERT INTO users (phone, first_name, last_name, username, language, created_at, last_seen)
       VALUES ($1, $2, $3, $4, 'ru', NOW(), NOW())
       RETURNING id, phone, username, first_name, last_name, avatar_url, bio, is_bot, is_premium, language, last_seen, created_at`,
      [phone, firstName, lastName, username]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Create user error:', error);
    throw new Error('Failed to create user');
  }
}

/**
 * Update user profile
 */
async function updateUserProfile(userId, data) {
  try {
    const { firstName, lastName, username, bio, avatarUrl, language } = data;

    const result = await query(
      `UPDATE users
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           username = COALESCE($3, username),
           bio = COALESCE($4, bio),
           avatar_url = COALESCE($5, avatar_url),
           language = COALESCE($6, language),
           updated_at = NOW()
       WHERE id = $7
       RETURNING id, phone, username, first_name, last_name, avatar_url, bio, is_bot, is_premium, language, last_seen, created_at`,
      [firstName, lastName, username, bio, avatarUrl, language, userId]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Update user profile error:', error);
    throw new Error('Failed to update user profile');
  }
}

/**
 * Update last seen
 */
async function updateLastSeen(userId) {
  try {
    await query(
      'UPDATE users SET last_seen = NOW() WHERE id = $1',
      [userId]
    );
    return true;
  } catch (error) {
    logger.error('Update last seen error:', error);
    throw new Error('Failed to update last seen');
  }
}

/**
 * Get user contacts
 */
async function getUserContacts(userId) {
  try {
    const result = await query(
      `SELECT u.id, u.phone, u.username, u.first_name, u.last_name, u.avatar_url, u.language, u.last_seen
       FROM contacts c
       JOIN users u ON c.contact_user_id = u.id
       WHERE c.user_id = $1
       ORDER BY u.first_name, u.last_name`,
      [userId]
    );

    return result.rows;
  } catch (error) {
    logger.error('Get user contacts error:', error);
    throw new Error('Failed to get contacts');
  }
}

/**
 * Add contact
 */
async function addContact(userId, contactUserId) {
  try {
    await query(
      `INSERT INTO contacts (user_id, contact_user_id, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, contact_user_id) DO NOTHING`,
      [userId, contactUserId]
    );
    return true;
  } catch (error) {
    logger.error('Add contact error:', error);
    throw new Error('Failed to add contact');
  }
}

/**
 * Block user
 */
async function blockUser(userId, blockedUserId) {
  try {
    await query(
      `INSERT INTO blocked_users (user_id, blocked_user_id, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, blocked_user_id) DO NOTHING`,
      [userId, blockedUserId]
    );
    return true;
  } catch (error) {
    logger.error('Block user error:', error);
    throw new Error('Failed to block user');
  }
}

/**
 * Unblock user
 */
async function unblockUser(userId, blockedUserId) {
  try {
    await query(
      'DELETE FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2',
      [userId, blockedUserId]
    );
    return true;
  } catch (error) {
    logger.error('Unblock user error:', error);
    throw new Error('Failed to unblock user');
  }
}

/**
 * Get blocked users
 */
async function getBlockedUsers(userId) {
  try {
    const result = await query(
      `SELECT u.id, u.phone, u.username, u.first_name, u.last_name, u.avatar_url
       FROM blocked_users b
       JOIN users u ON b.blocked_user_id = u.id
       WHERE b.user_id = $1`,
      [userId]
    );
    
    return result.rows;
  } catch (error) {
    logger.error('Get blocked users error:', error);
    throw new Error('Failed to get blocked users');
  }
}

/**
 * Delete user account
 */
async function deleteUser(userId) {
  try {
    await query('DELETE FROM users WHERE id = $1', [userId]);
    return true;
  } catch (error) {
    logger.error('Delete user error:', error);
    throw new Error('Failed to delete user');
  }
}

/**
 * Get all user settings
 */
async function getAllSettings(userId) {
  try {
    const result = await query(
      'SELECT settings, privacy_settings, notification_settings, sound_settings, storage_settings, advanced_settings FROM user_settings WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      // Create default settings if not exist
      await query(
        'INSERT INTO user_settings (user_id) VALUES ($1)',
        [userId]
      );
      return {
        theme: 'dark',
        notifications: true,
        sounds: true,
        language: 'ru'
      };
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Get all settings error:', error);
    throw new Error('Failed to get settings');
  }
}

/**
 * Update all user settings
 */
async function updateAllSettings(userId, settings) {
  try {
    // Merge with existing settings
    const existing = await getAllSettings(userId);
    const updatedSettings = { ...existing.settings, ...settings };

    await query(
      `INSERT INTO user_settings (user_id, settings, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         settings = EXCLUDED.settings,
         updated_at = NOW()`,
      [userId, JSON.stringify(updatedSettings)]
    );

    // Update language in users table if changed
    if (settings.language) {
      await query(
        'UPDATE users SET language = $1 WHERE id = $2',
        [settings.language, userId]
      );
    }

    return updatedSettings;
  } catch (error) {
    logger.error('Update all settings error:', error);
    throw new Error('Failed to update settings');
  }
}

/**
 * Search users
 */
async function searchUsers(queryText, limit = 20) {
  try {
    const result = await query(
      `SELECT id, phone, username, first_name, last_name, avatar_url, bio, language, last_seen
       FROM users
       WHERE (username ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1)
       AND id NOT IN (SELECT blocked_user_id FROM blocked_users WHERE user_id = $2)
       LIMIT $3`,
      [`%${queryText}%`, queryText, limit]
    );

    return result.rows;
  } catch (error) {
    logger.error('Search users error:', error);
    throw new Error('Failed to search users');
  }
}

module.exports = {
  getUserById,
  getUserByPhone,
  getUserByUsername,
  createUser,
  updateUserProfile,
  updateLastSeen,
  getUserContacts,
  addContact,
  blockUser,
  unblockUser,
  getBlockedUsers,
  deleteUser,
  searchUsers,
  getAllSettings,
  updateAllSettings
};
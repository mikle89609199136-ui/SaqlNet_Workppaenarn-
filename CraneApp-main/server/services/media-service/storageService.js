const { query } = require('../../../database/database');
const logger = require('../logger');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

/**
 * Save file to storage
 */
async function saveFile(file, userId, chatId, type) {
  try {
    const mediaId = uuidv4();
    const fileName = `${mediaId}${path.extname(file.originalname)}`;
    const filePath = path.join(__dirname, '../../../uploads', fileName);

    // Save file to disk
    fs.writeFileSync(filePath, file.buffer);

    // Save to database
    const result = await query(
      `INSERT INTO message_media (id, message_id, media_type, media_url, file_size, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [mediaId, null, type, `/uploads/${fileName}`, file.size]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Save file service error:', error);
    throw new Error('Failed to save file');
  }
}

/**
 * Get media by ID
 */
async function getMedia(mediaId) {
  try {
    const result = await query(
      'SELECT * FROM message_media WHERE id = $1',
      [mediaId]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Get media service error:', error);
    throw new Error('Failed to get media');
  }
}

/**
 * Delete media by ID
 */
async function deleteMedia(mediaId, userId) {
  try {
    const media = await getMedia(mediaId);
    
    if (media) {
      // Delete file from disk
      const filePath = path.join(__dirname, '../../../uploads', path.basename(media.media_url));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete from database
      await query('DELETE FROM message_media WHERE id = $1', [mediaId]);
    }

    return true;
  } catch (error) {
    logger.error('Delete media service error:', error);
    throw new Error('Failed to delete media');
  }
}

/**
 * Get all media for a chat
 */
async function getChatMedia(chatId, limit = 50, offset = 0) {
  try {
    const result = await query(
      `SELECT mm.*, m.sender_id, m.created_at as message_created_at
       FROM message_media mm
       JOIN messages m ON mm.message_id = m.id
       WHERE m.chat_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [chatId, limit, offset]
    );

    return result.rows;
  } catch (error) {
    logger.error('Get chat media service error:', error);
    throw new Error('Failed to get chat media');
  }
}

/**
 * Get file size in bytes
 */
function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    logger.error('Get file size error:', error);
    return 0;
  }
}

module.exports = {
  saveFile,
  getMedia,
  deleteMedia,
  getChatMedia,
  getFileSize
};
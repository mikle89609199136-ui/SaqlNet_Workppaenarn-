const { query } = require('../../../database/database');
const logger = require('../logger');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const uploadsDir = path.join(__dirname, '../../../uploads');

/**
 * Upload Service
 * Handle file uploads, compression, and thumbnail generation
 */

async function saveFile(file, userId, chatId, type = 'file') {
    try {
        const fileId = uuidv4();
        const ext = path.extname(file.originalname).toLowerCase();
        const fileName = `${fileId}${ext}`;
        const filePath = path.join(uploadsDir, fileName);
        
        // Ensure uploads directory exists
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        // Save original file
        fs.writeFileSync(filePath, file.buffer);

        let thumbnailUrl = null;
        let compressedUrl = null;

        // Generate thumbnail for images
        if (type === 'image' && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            const thumbFileName = `${fileId}_thumb.jpg`;
            const thumbPath = path.join(uploadsDir, thumbFileName);
            
            await sharp(file.buffer)
                .resize(320, 320, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toFile(thumbPath);
            
            thumbnailUrl = `/uploads/${thumbFileName}`;
        }

        // Compress large images
        if (type === 'image' && file.size > 500000) {
            const compFileName = `${fileId}_comp.jpg`;
            const compPath = path.join(uploadsDir, compFileName);
            
            await sharp(file.buffer)
                .resize(1920, 1920, { fit: 'inside' })
                .jpeg({ quality: 85 })
                .toFile(compPath);
            
            // Replace original with compressed
            fs.unlinkSync(filePath);
            fs.renameSync(compPath, filePath);
            compressedUrl = `/uploads/${fileName}`;
        }

        // Save to database
        const result = await query(
            `INSERT INTO media_files (id, owner_id, chat_id, file_type, file_url, thumbnail_url, file_size, original_name, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             RETURNING *`,
            [fileId, userId, chatId, type, `/uploads/${fileName}`, thumbnailUrl, file.size, file.originalname]
        );

        return result.rows[0];
    } catch (error) {
        logger.error('Save file service error:', error);
        throw new Error('Failed to save file');
    }
}

async function getFile(fileId, userId) {
    try {
        const result = await query(
            `SELECT * FROM media_files WHERE id = $1 AND (owner_id = $2 OR chat_id IN (
                SELECT chat_id FROM chat_members WHERE user_id = $2
            ))`,
            [fileId, userId]
        );
        return result.rows[0];
    } catch (error) {
        logger.error('Get file service error:', error);
        throw new Error('Failed to get file');
    }
}

async function deleteFile(fileId, userId) {
    try {
        const file = await getFile(fileId, userId);
        
        if (file) {
            // Delete from disk
            const filePath = path.join(uploadsDir, path.basename(file.file_url));
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            // Delete thumbnail
            if (file.thumbnail_url) {
                const thumbPath = path.join(uploadsDir, path.basename(file.thumbnail_url));
                if (fs.existsSync(thumbPath)) {
                    fs.unlinkSync(thumbPath);
                }
            }
            
            // Delete from database
            await query('DELETE FROM media_files WHERE id = $1', [fileId]);
        }
        
        return true;
    } catch (error) {
        logger.error('Delete file service error:', error);
        throw new Error('Failed to delete file');
    }
}

async function getChatMedia(chatId, limit = 50, offset = 0) {
    try {
        const result = await query(
            `SELECT * FROM media_files 
             WHERE chat_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [chatId, limit, offset]
        );
        return result.rows;
    } catch (error) {
        logger.error('Get chat media service error:', error);
        throw new Error('Failed to get chat media');
    }
}

async function getUserMedia(userId, limit = 50, offset = 0) {
    try {
        const result = await query(
            `SELECT * FROM media_files 
             WHERE owner_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        return result.rows;
    } catch (error) {
        logger.error('Get user media service error:', error);
        throw new Error('Failed to get user media');
    }
}

function getFileType(mimetype) {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.includes('pdf') || mimetype.includes('document')) return 'document';
    return 'file';
}

module.exports = {
    saveFile,
    getFile,
    deleteFile,
    getChatMedia,
    getUserMedia,
    getFileType
};
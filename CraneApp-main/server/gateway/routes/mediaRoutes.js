const express = require('express');

function createMediaRoutes({ authMiddleware, logger, query, uploadLimiter, uuidv4 }) {
    const router = express.Router();

    router.post('/upload', uploadLimiter, authMiddleware, async (req, res) => {
        try {
            const { file, purpose } = req.body;

            if (!file) {
                return res.status(400).json({ error: 'File required' });
            }

            const mediaId = uuidv4();
            const isMessageMedia = purpose === 'message';
            if (isMessageMedia) {
                const validationError = validateEncryptedMediaPayload(file);
                if (validationError) {
                    return res.status(400).json({ error: validationError });
                }

                const encryption = encryptedMediaMetadata(file);
                await query(
                    `INSERT INTO media_files (id, user_id, data, mime_type, size_bytes, encrypted, encryption, created_at)
                     VALUES ($1, $2, $3, $4, $5, TRUE, $6, NOW())`,
                    [mediaId, req.user.id, file.ciphertext, file.mimeType, file.sizeBytes, encryption]
                );

                logger.info('✅ Encrypted media stored in DB:', mediaId, file.mimeType, `${Math.round(file.sizeBytes / 1024)}KB`);
                return res.json({ success: true, url: `/api/v2/media/${mediaId}`, encrypted: true, encryption });
            }

            if (typeof file !== 'string') {
                return res.status(400).json({ error: 'Plain uploads must be data URLs' });
            }

            const mimeMatch = file.match(/^data:([^;]+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
            const base64Data = file.replace(/^data:[^;]+;base64,/, '');
            const sizeBytes = Math.round(base64Data.length * 0.75);

            await query(
                `INSERT INTO media_files (id, user_id, data, mime_type, size_bytes, encrypted, encryption, created_at)
                 VALUES ($1, $2, $3, $4, $5, FALSE, NULL, NOW())`,
                [mediaId, req.user.id, file, mimeType, sizeBytes]
            );

            logger.info('✅ Media stored in DB:', mediaId, mimeType, `${Math.round(sizeBytes / 1024)}KB`);
            return res.json({ success: true, url: `/api/v2/media/${mediaId}` });
        } catch (error) {
            logger.error('❌ Upload error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/media/:mediaId', async (req, res) => {
        try {
            const result = await query(
                'SELECT data, mime_type, size_bytes, encrypted, encryption FROM media_files WHERE id = $1',
                [req.params.mediaId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Media not found' });
            }

            const { data, mime_type, size_bytes, encrypted, encryption } = result.rows[0];
            if (encrypted) {
                const encryptionMetadata = normalizeJson(encryption);
                res.setHeader('Cache-Control', 'private, max-age=86400');
                return res.json({
                    ...encryptionMetadata,
                    encrypted: true,
                    ciphertext: data,
                    mimeType: encryptionMetadata.mimeType || mime_type || 'application/octet-stream',
                    sizeBytes: encryptionMetadata.sizeBytes || size_bytes || 0,
                });
            }

            const base64 = data.replace(/^data:[^;]+;base64,/, '');
            const buffer = Buffer.from(base64, 'base64');

            res.setHeader('Content-Type', mime_type || 'application/octet-stream');
            res.setHeader('Content-Length', buffer.length);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.send(buffer);
        } catch (error) {
            logger.error('❌ Media serve error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

function validateEncryptedMediaPayload(file) {
    if (!file || typeof file !== 'object') return 'Encrypted media payload required';
    if (file.encrypted !== true) return 'Message media must be encrypted';
    if (file.version !== 1) return 'Unsupported encrypted media version';
    if (file.algorithm !== 'AES-GCM') return 'Unsupported media encryption algorithm';
    if (!file.iv || !file.ciphertext || !file.mimeType || !Number.isFinite(file.sizeBytes)) {
        return 'Encrypted media metadata incomplete';
    }
    return null;
}

function encryptedMediaMetadata(file) {
    return {
        version: file.version,
        encrypted: true,
        algorithm: file.algorithm,
        iv: file.iv,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        ...(file.fileName ? { fileName: file.fileName } : {}),
    };
}

function normalizeJson(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (_error) {
            return {};
        }
    }
    return value;
}

module.exports = createMediaRoutes;

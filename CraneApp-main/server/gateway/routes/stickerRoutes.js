const express = require('express');
const fs = require('fs');
const path = require('path');

function createStickerRoutes({ authMiddleware, handleFileUpload, logger, projectRoot, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/packs', async (req, res) => {
        try {
            const result = await query(
                `SELECT sp.*,
                        (SELECT COUNT(*) FROM stickers WHERE pack_id = sp.id) as sticker_count
                 FROM sticker_packs sp
                 WHERE sp.user_id = $1
                 ORDER BY sp.created_at DESC`,
                [req.user.id]
            );

            res.json({ packs: result.rows.map(mapPack) });
        } catch (error) {
            logger.error('❌ Get sticker packs error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/packs', async (req, res) => {
        try {
            const { name, description, icon } = req.body;
            if (!name || name.trim().length === 0) {
                return res.status(400).json({ error: 'Name required' });
            }

            const packId = uuidv4();
            const iconUrl = icon ? handleFileUpload(icon, 'sticker', 'stickers') : null;

            await query(
                `INSERT INTO sticker_packs (id, user_id, name, description, icon_url, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
                [packId, req.user.id, name.trim(), description || '', iconUrl]
            );

            logger.info('✅ Sticker pack created:', packId);
            res.status(201).json({
                success: true,
                pack: {
                    id: packId,
                    name: name.trim(),
                    description: description || '',
                    iconUrl,
                    stickerCount: 0,
                    createdAt: new Date(),
                },
            });
        } catch (error) {
            logger.error('❌ Create sticker pack error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.put('/packs/:packId', async (req, res) => {
        try {
            const { packId } = req.params;
            const { name, description, icon } = req.body;
            const packCheck = await findOwnedPack(query, packId, req.user.id);
            if (!packCheck) return res.status(404).json({ error: 'Pack not found' });

            const iconUrl = icon ? handleFileUpload(icon, 'sticker', 'stickers') : null;
            const updates = [];
            const values = [];
            let index = 1;

            if (name) {
                updates.push(`name = $${index++}`);
                values.push(name);
            }
            if (description !== undefined) {
                updates.push(`description = $${index++}`);
                values.push(description);
            }
            if (iconUrl) {
                updates.push(`icon_url = $${index++}`);
                values.push(iconUrl);
            }

            if (updates.length > 0) {
                updates.push('updated_at = NOW()');
                values.push(packId);
                await query(`UPDATE sticker_packs SET ${updates.join(', ')} WHERE id = $${index}`, values);
            }

            logger.info('✅ Sticker pack updated:', packId);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Update sticker pack error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/packs/:packId', async (req, res) => {
        try {
            const { packId } = req.params;
            const pack = await findOwnedPack(query, packId, req.user.id, 'icon_url');
            if (!pack) return res.status(404).json({ error: 'Pack not found' });

            const stickers = await query('SELECT image_url FROM stickers WHERE pack_id = $1', [packId]);
            stickers.rows.forEach((sticker) => deleteUpload(projectRoot, sticker.image_url));
            deleteUpload(projectRoot, pack.icon_url);

            await query('DELETE FROM stickers WHERE pack_id = $1', [packId]);
            await query('DELETE FROM sticker_packs WHERE id = $1', [packId]);

            logger.info('✅ Sticker pack deleted:', packId);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Delete sticker pack error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/packs/:packId', async (req, res) => {
        try {
            const { packId } = req.params;
            const pack = await findOwnedPack(query, packId, req.user.id);
            if (!pack) return res.status(404).json({ error: 'Pack not found' });

            const result = await query(
                'SELECT * FROM stickers WHERE pack_id = $1 ORDER BY created_at DESC',
                [packId]
            );

            res.json({
                stickers: result.rows.map((sticker) => ({
                    id: sticker.id,
                    imageUrl: sticker.image_url,
                    createdAt: sticker.created_at,
                })),
            });
        } catch (error) {
            logger.error('❌ Get stickers error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/packs/:packId', async (req, res) => {
        try {
            const { packId } = req.params;
            const { image } = req.body;
            const pack = await findOwnedPack(query, packId, req.user.id);
            if (!pack) return res.status(404).json({ error: 'Pack not found' });
            if (!image) return res.status(400).json({ error: 'Image required' });

            const stickerId = uuidv4();
            const imageUrl = handleFileUpload(image, 'sticker', 'stickers');

            await query(
                `INSERT INTO stickers (id, pack_id, image_url, created_at)
                 VALUES ($1, $2, $3, NOW())`,
                [stickerId, packId, imageUrl]
            );

            logger.info('✅ Sticker added:', stickerId);
            res.status(201).json({
                success: true,
                sticker: {
                    id: stickerId,
                    imageUrl,
                    createdAt: new Date(),
                },
            });
        } catch (error) {
            logger.error('❌ Add sticker error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/:stickerId', async (req, res) => {
        try {
            const result = await query(
                `SELECT s.id, s.image_url, sp.user_id
                 FROM stickers s
                 JOIN sticker_packs sp ON s.pack_id = sp.id
                 WHERE s.id = $1`,
                [req.params.stickerId]
            );
            const sticker = result.rows[0];

            if (!sticker) return res.status(404).json({ error: 'Sticker not found' });
            if (sticker.user_id !== req.user.id) {
                return res.status(403).json({ error: req.t('accessDenied') });
            }

            deleteUpload(projectRoot, sticker.image_url);
            await query('DELETE FROM stickers WHERE id = $1', [req.params.stickerId]);

            logger.info('✅ Sticker deleted:', req.params.stickerId);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Delete sticker error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

async function findOwnedPack(query, packId, userId, columns = 'id') {
    const result = await query(
        `SELECT ${columns} FROM sticker_packs WHERE id = $1 AND user_id = $2`,
        [packId, userId]
    );
    return result.rows[0] || null;
}

function deleteUpload(projectRoot, uploadPath) {
    if (!uploadPath) return;
    const filepath = path.join(projectRoot, uploadPath);
    if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
    }
}

function mapPack(pack) {
    return {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        iconUrl: pack.icon_url,
        stickerCount: parseInt(pack.sticker_count, 10),
        createdAt: pack.created_at,
    };
}

module.exports = createStickerRoutes;

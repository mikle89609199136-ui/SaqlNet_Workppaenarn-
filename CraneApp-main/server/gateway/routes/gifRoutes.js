const express = require('express');

function createGifRoutes({ authMiddleware, logger, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    router.get('/', async (req, res) => {
        try {
            const result = await query(
                `SELECT g.*, u.first_name as user_name
                 FROM gifs g
                 LEFT JOIN users u ON g.user_id = u.id
                 ORDER BY g.created_at DESC
                 LIMIT 100`
            );

            res.json({ gifs: mapGifs(result.rows) });
        } catch (error) {
            logger.error('❌ Get GIFs error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/', async (req, res) => {
        try {
            const { name, url } = req.body;
            if (!url) return res.status(400).json({ error: 'URL required' });

            const gifId = uuidv4();
            await query(
                `INSERT INTO gifs (id, user_id, name, url, created_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [gifId, req.user.id, name || '', url]
            );

            logger.info('✅ GIF created:', gifId);
            res.status(201).json({
                success: true,
                gif: {
                    id: gifId,
                    name: name || '',
                    url,
                    createdAt: new Date(),
                },
            });
        } catch (error) {
            logger.error('❌ Create GIF error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/favorites', async (req, res) => {
        try {
            const result = await query(
                `SELECT g.*, u.first_name as user_name
                 FROM favorite_gifs fg
                 JOIN gifs g ON fg.gif_id = g.id
                 LEFT JOIN users u ON g.user_id = u.id
                 WHERE fg.user_id = $1
                 ORDER BY fg.created_at DESC
                 LIMIT 100`,
                [req.user.id]
            );

            res.json({ gifs: mapGifs(result.rows) });
        } catch (error) {
            logger.error('❌ Get favorite GIFs error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/:gifId/favorite', async (req, res) => {
        try {
            const { gifId } = req.params;
            const gifCheck = await query('SELECT id FROM gifs WHERE id = $1', [gifId]);
            if (gifCheck.rows.length === 0) {
                return res.status(404).json({ error: 'GIF not found' });
            }

            try {
                await query(
                    `INSERT INTO favorite_gifs (id, user_id, gif_id, created_at)
                     VALUES ($1, $2, $3, NOW())`,
                    [uuidv4(), req.user.id, gifId]
                );
            } catch (error) {
                if (error.code === '23505') {
                    return res.json({ success: true, already: true });
                }
                throw error;
            }

            logger.info('✅ GIF added to favorites:', gifId);
            res.status(201).json({ success: true });
        } catch (error) {
            logger.error('❌ Add to favorites error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/:gifId/favorite', async (req, res) => {
        try {
            await query(
                'DELETE FROM favorite_gifs WHERE user_id = $1 AND gif_id = $2',
                [req.user.id, req.params.gifId]
            );

            logger.info('✅ GIF removed from favorites:', req.params.gifId);
            res.json({ success: true });
        } catch (error) {
            logger.error('❌ Remove from favorites error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

function mapGifs(rows) {
    return rows.map((gif) => ({
        id: gif.id,
        name: gif.name,
        url: gif.url,
        userName: gif.user_name,
        createdAt: gif.created_at,
    }));
}

module.exports = createGifRoutes;

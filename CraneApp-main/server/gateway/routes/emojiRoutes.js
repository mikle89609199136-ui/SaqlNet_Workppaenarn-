const express = require('express');

function createEmojiRoutes({ applemojis }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        try {
            const emojis = applemojis.getAll().map((emoji) => ({
                code: emoji.code,
                img: emoji.emoji,
            }));
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.json({ emojis });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = createEmojiRoutes;

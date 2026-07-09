const express = require('express');

function createHealthRoutes({ wss }) {
    const router = express.Router();

    router.get('/health', (req, res) => {
        res.status(200).json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            connections: wss.clients.size,
        });
    });

    router.get('/v1/health', (req, res) => {
        res.status(200).json({ status: 'ok', uptime: process.uptime() });
    });

    return router;
}

module.exports = createHealthRoutes;

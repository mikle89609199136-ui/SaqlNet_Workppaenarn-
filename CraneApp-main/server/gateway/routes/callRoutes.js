const express = require('express');

function createCallRoutes({
    authFromHeader,
    callRoom,
    fetchTurnCredentials,
    getIceServers,
}) {
    const router = express.Router();

    router.post('/rooms', async (req, res) => {
        const user = await authFromHeader(req);
        if (!user) return res.status(401).json({ error: req.t('unauthorized') });

        const { type = 'group', chatId = null, title = null, callKind = 'video' } = req.body || {};
        const room = callRoom.createRoom(user.userId, { type, chatId, title, callKind });

        res.json({
            success: true,
            room: {
                id: room.id,
                type: room.type,
                chatId: room.chatId,
                title: room.title,
                hostId: room.hostId,
            },
            iceServers: getIceServers(),
            maxParticipants: callRoom.MAX_PARTICIPANTS,
        });
    });

    router.get('/rooms/:roomId', async (req, res) => {
        const user = await authFromHeader(req);
        if (!user) return res.status(401).json({ error: req.t('unauthorized') });

        const room = callRoom.getRoom(req.params.roomId);
        if (!room) return res.status(404).json({ error: 'Room not found' });

        res.json({
            success: true,
            room: {
                id: room.id,
                type: room.type,
                chatId: room.chatId,
                title: room.title,
                hostId: room.hostId,
                participants: Array.from(room.participants.values()),
            },
            iceServers: getIceServers(),
            maxParticipants: callRoom.MAX_PARTICIPANTS,
        });
    });

    router.get('/ice-servers', async (req, res) => {
        const servers = getIceServers();
        const hasTurn = servers.some((server) => {
            const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
            return urls.some((url) => url.startsWith('turn:'));
        });

        res.json({
            servers,
            hasTurn,
            meteredConfigured: !!(process.env.METERED_API_KEY && process.env.METERED_DOMAIN),
            meteredTest: await fetchTurnCredentials(),
        });
    });

    router.get('/rooms', async (req, res) => {
        const user = await authFromHeader(req);
        if (!user) return res.status(401).json({ error: req.t('unauthorized') });

        res.json({ success: true, rooms: callRoom.listRooms() });
    });

    return router;
}

module.exports = createCallRoutes;

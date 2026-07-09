/**
 * In-memory room manager для видеозвонков.
 * Mesh-топология (P2P между всеми), лимит 5 участников.
 */

const logger = require('../logger');

const MAX_PARTICIPANTS = 5;

// roomId -> { id, hostId, type ('p2p'|'group'), callKind ('video'|'audio'), chatId, createdAt, answeredAt, participants }
const rooms = new Map();

// userId -> roomId (быстрая проверка — пользователь уже в звонке)
const userToRoom = new Map();

function createRoom(hostId, opts = {}) {
    const roomId = (opts.roomId) || ('rm_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
    if (rooms.has(roomId)) return rooms.get(roomId);
    const room = {
        id: roomId,
        hostId,
        type: opts.type || 'group',
        callKind: opts.callKind || 'video',
        chatId: opts.chatId || null,
        title: opts.title || null,
        createdAt: Date.now(),
        answeredAt: null,
        participants: new Map()
    };
    rooms.set(roomId, room);
    logger.info(`📞 Room created: ${roomId} by ${hostId}`);
    return room;
}

function getRoom(roomId) { return rooms.get(roomId) || null; }

function joinRoom(roomId, userId, info = {}) {
    const room = rooms.get(roomId);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.participants.size >= MAX_PARTICIPANTS && !room.participants.has(userId)) {
        return { ok: false, error: 'room_full' };
    }
    // Если пользователь уже в другой комнате — выкидываем оттуда
    const prev = userToRoom.get(userId);
    if (prev && prev !== roomId) leaveRoom(prev, userId);

    room.participants.set(userId, {
        userId,
        joinedAt: Date.now(),
        displayName: info.displayName || null,
        avatarUrl: info.avatarUrl || null
    });
    userToRoom.set(userId, roomId);
    // Фиксируем момент когда в комнате оказалось ≥2 участников (звонок принят)
    if (!room.answeredAt && room.participants.size >= 2) {
        room.answeredAt = Date.now();
    }
    return { ok: true, room, peers: listOtherPeers(room, userId) };
}

function leaveRoom(roomId, userId) {
    const room = rooms.get(roomId);
    if (!room) return { ok: false };
    const had = room.participants.delete(userId);
    if (userToRoom.get(userId) === roomId) userToRoom.delete(userId);

    if (room.participants.size === 0) {
        // Снимок перед удалением — нужен для сохранения сообщения о звонке
        const snapshot = {
            chatId: room.chatId,
            callKind: room.callKind,
            answeredAt: room.answeredAt,
            createdAt: room.createdAt,
            hostId: room.hostId,
            type: room.type
        };
        rooms.delete(roomId);
        logger.info(`📞 Room closed: ${roomId}`);
        return { ok: true, closed: true, had, ...snapshot };
    }
    return { ok: true, closed: false, had };
}

function listOtherPeers(room, exceptUserId) {
    const out = [];
    for (const p of room.participants.values()) {
        if (p.userId !== exceptUserId) out.push(p);
    }
    return out;
}

function getUserRoom(userId) {
    const rid = userToRoom.get(userId);
    return rid ? rooms.get(rid) || null : null;
}

function listRooms() {
    return Array.from(rooms.values()).map(r => ({
        id: r.id, type: r.type, hostId: r.hostId, chatId: r.chatId,
        title: r.title, createdAt: r.createdAt, count: r.participants.size
    }));
}

module.exports = {
    MAX_PARTICIPANTS,
    createRoom,
    getRoom,
    joinRoom,
    leaveRoom,
    listOtherPeers,
    getUserRoom,
    listRooms
};

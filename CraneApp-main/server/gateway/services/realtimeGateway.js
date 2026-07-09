function createRealtimeGateway({ callRoom, jwt, jwtSecret, logger, query, saveCallMessage, WebSocket, WS_CONNECTIONS, wss }) {
    const connectedUsers = new Map();
    // userId -> { type, roomId, kind, from, fromName, fromAvatar, title }
    // Хранит call_incoming для пользователей, которых не было онлайн в момент звонка
    const pendingCallInvites = new Map();
    
    // Throttle last_seen updates: не чаще 1 раза в 30 секунд на пользователя
    const _lastSeenTs = new Map();
    function throttleLastSeen(userId) {
        const now = Date.now();
        if ((_lastSeenTs.get(userId) || 0) > now - 30000) return;
        _lastSeenTs.set(userId, now);
        query('UPDATE users SET last_seen = NOW() WHERE id = $1', [userId]).catch(() => {});
    }
    
    wss.on('connection', async (ws, req) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
        
        // Защита WebSocket от flood — максимум 5 соединений с одного IP
        const wsCount = WS_CONNECTIONS.get(ip) || 0;
        if (wsCount >= 5) {
            logger.warn(`🚫 WS flood: too many connections from ${ip}`);
            ws.close(1008, 'Too many connections');
            return;
        }
        WS_CONNECTIONS.set(ip, wsCount + 1);
        
        // Счётчик сообщений для защиты от WS flood
        let wsMessageCount = 0;
        let wsMessageResetAt = Date.now() + 1000;
        
        const urlParams = new URLSearchParams(req.url.split('?')[1]);

        // Verify JWT — accept token from query string or Authorization header.
        // Never trust the userId parameter directly.
        let userId;
        try {
            const token = urlParams.get('token') ||
                (() => {
                    const auth = req.headers['authorization'] || '';
                    return auth.startsWith('Bearer ') ? auth.slice(7) : null;
                })();
            if (!token || !jwtSecret) throw new Error('missing token');
            const decoded = jwt.verify(token, jwtSecret);
            userId = decoded.userId || decoded.id || decoded.sub;
            if (!userId) throw new Error('no userId in token');
        } catch (err) {
            logger.warn(`🚫 WS auth failed from ${ip}: ${err.message}`);
            ws.close(1008, 'Unauthorized');
            const currentCount = WS_CONNECTIONS.get(ip) || 1;
            if (currentCount <= 1) WS_CONNECTIONS.delete(ip);
            else WS_CONNECTIONS.set(ip, currentCount - 1);
            return;
        }

        logger.info('🔌 WebSocket connection:', userId, 'from', ip);
    
        // last_seen + рассылка статуса "онлайн" — в фоне, не блокируем WS-handshake
        if (userId && !userId.startsWith('anonymous')) {
            (async () => {
                try {
                    await query('UPDATE users SET last_seen = NOW(), is_online = TRUE WHERE id = $1', [userId]);
                    // Один JOIN вместо N+1: все пользователи, которые состоят в одном чате с userId
                    const res = await query(
                        `SELECT DISTINCT cm2.user_id
                         FROM chat_members cm1
                         JOIN chat_members cm2 ON cm1.chat_id = cm2.chat_id AND cm2.user_id != $1
                         WHERE cm1.user_id = $1`,
                        [userId]
                    );
                    const statusMsg = JSON.stringify({
                        type: 'user_status', userId, isOnline: true,
                        lastSeen: new Date().toISOString()
                    });
                    for (const row of res.rows) {
                        const conns = connectedUsers.get(row.user_id);
                        if (!conns) continue;
                        for (const c of conns) {
                            if (c.readyState === WebSocket.OPEN) {
                                try { c.send(statusMsg); } catch (_) {}
                            }
                        }
                    }
                } catch (_) {}
            })();
        }
    
        if (!connectedUsers.has(userId)) {
            connectedUsers.set(userId, new Set());
        }
        connectedUsers.get(userId).add(ws);
    
        ws.userId = userId;
        ws.isAlive = true;
    
        // Если есть незакрытый звонок для этого пользователя — отправляем сразу
        if (!userId.startsWith('anonymous')) {
            const _pending = pendingCallInvites.get(userId);
            if (_pending && callRoom.getRoom(_pending.roomId)) {
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        try { ws.send(JSON.stringify(_pending)); } catch (_) {}
                    }
                }, 800);
            } else if (_pending) {
                pendingCallInvites.delete(userId);
            }
        }
    
        // Ping/pong для проверки соединения
        ws.on('pong', () => {
            ws.isAlive = true;
        });
    
        ws.on('message', async (data) => {
            // Ограничение размера сообщения — 64KB
            if (data.length > 64 * 1024) {
                ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }));
                return;
            }
    
            let msg;
            try {
                msg = JSON.parse(data);
            } catch (_) {
                return;
            }
    
            // WS flood protection — WebRTC-сигнализация (ICE/SDP) не ограничивается,
            // т.к. браузер генерирует 20–30 ICE-кандидатов за 1 сек при подключении
            const isRtcSignaling = msg.type === 'call_ice' || msg.type === 'call_offer' ||
                                   msg.type === 'call_answer' || msg.type === 'call_join';
            if (!isRtcSignaling) {
                const now = Date.now();
                if (now > wsMessageResetAt) {
                    wsMessageCount = 0;
                    wsMessageResetAt = now + 1000;
                }
                wsMessageCount++;
                if (wsMessageCount > 30) {
                    logger.warn(`🚫 WS message flood from ${ip} (user: ${userId})`);
                    ws.close(1008, 'Message rate limit exceeded');
                    return;
                }
            }
    
            try {
                // Обновляем last_seen — не чаще 1 раза в 30 сек, не блокируем обработку
                if (userId && !userId.startsWith('anonymous')) throttleLastSeen(userId);
                
                switch (msg.type) {
                    case 'chat_message':
                        if (msg.chatId && msg.message) {
                            broadcastToChat(msg.chatId, { type: 'new_message', chatId: msg.chatId, message: msg.message }, ws.userId);
                        }
                        break;
                    case 'typing':
                        if (msg.chatId) {
                            broadcastToChat(msg.chatId, { type: 'user_typing', chatId: msg.chatId, userId: ws.userId }, ws.userId);
                        }
                        break;
                    case 'ping':
                        ws.send(JSON.stringify({ type: 'pong' }));
                        break;
    
                    // ===== Видеозвонки =====
                    case 'call_join': {
                        if (!msg.roomId) break;
                        // Сохраняем callKind на комнате если клиент его прислал
                        const existingRoom = callRoom.getRoom(msg.roomId);
                        if (existingRoom && msg.callKind) existingRoom.callKind = msg.callKind;
                        const r = callRoom.joinRoom(msg.roomId, ws.userId, {
                            displayName: msg.displayName || null,
                            avatarUrl: msg.avatarUrl || null
                        });
                        if (!r.ok) {
                            ws.send(JSON.stringify({ type: 'call_error', reason: r.error }));
                            break;
                        }
                        // Сохраняем roomId на сокете
                        ws.callRoomId = msg.roomId;
                        // Шлём текущему — список существующих участников (peers)
                        ws.send(JSON.stringify({
                            type: 'call_joined',
                            roomId: msg.roomId,
                            peers: r.peers,
                            self: { userId: ws.userId }
                        }));
                        // Шлём остальным — что новый участник присоединился
                        sendToCallRoom(msg.roomId, {
                            type: 'call_peer_joined',
                            roomId: msg.roomId,
                            peer: { userId: ws.userId, displayName: msg.displayName || null, avatarUrl: msg.avatarUrl || null }
                        }, ws.userId);
                        break;
                    }
                    case 'call_leave': {
                        const roomId = ws.callRoomId || msg.roomId;
                        if (!roomId) break;
                        const lr = callRoom.leaveRoom(roomId, ws.userId);
                        sendToCallRoom(roomId, {
                            type: 'call_peer_left',
                            roomId,
                            peer: { userId: ws.userId }
                        }, ws.userId);
                        if (lr && lr.ok) saveCallMessage(lr).catch(() => {});
                        // Комната закрылась — уведомляем pending-адресатов и зачищаем
                        if (lr && lr.closed) {
                            for (const [uid, inv] of pendingCallInvites) {
                                if (inv.roomId === roomId) {
                                    sendToUser(uid, { type: 'call_cancelled', roomId });
                                    pendingCallInvites.delete(uid);
                                }
                            }
                        }
                        ws.callRoomId = null;
                        break;
                    }
                    case 'call_offer':
                    case 'call_answer':
                    case 'call_ice': {
                        if (!msg.to || !msg.payload) break;
                        sendToUser(msg.to, {
                            type: msg.type,
                            roomId: msg.roomId || ws.callRoomId,
                            from: ws.userId,
                            payload: msg.payload
                        });
                        break;
                    }
                    case 'call_invite': {
                        // Приглашение конкретного пользователя в комнату
                        if (!msg.to || !msg.roomId) break;
                        const _invite = {
                            type: 'call_incoming',
                            roomId: msg.roomId,
                            kind: msg.kind || 'video',
                            callType: msg.callType || 'p2p',
                            from: ws.userId,
                            fromName: msg.fromName || null,
                            fromAvatar: msg.fromAvatar || null,
                            title: msg.title || null
                        };
                        sendToUser(msg.to, _invite);
                        // Сохраняем invite — если адресат был офлайн, он получит его при подключении
                        pendingCallInvites.set(msg.to, _invite);
                        break;
                    }
                    case 'call_invite_response': {
                        // Ответ на приглашение (accepted/rejected) — уведомляем инициатора
                        if (!msg.to) break;
                        sendToUser(msg.to, {
                            type: 'call_invite_response',
                            roomId: msg.roomId,
                            from: ws.userId,
                            accepted: !!msg.accepted
                        });
                        // Invite обработан — убираем pending
                        pendingCallInvites.delete(ws.userId);
                        break;
                    }
    
                    default:
                        ws.send(JSON.stringify({ type: 'received', data: msg }));
                }
            } catch (error) {
                logger.error('❌ WS error:', error);
            }
        });
    
        ws.on('close', async () => {
            // Уменьшаем счётчик WS соединений для IP
            const currentCount = WS_CONNECTIONS.get(ip) || 1;
            if (currentCount <= 1) WS_CONNECTIONS.delete(ip);
            else WS_CONNECTIONS.set(ip, currentCount - 1);
    
            // Если пользователь был в видеозвонке — оповещаем остальных и убираем
            if (ws.callRoomId) {
                try {
                    const lr = callRoom.leaveRoom(ws.callRoomId, ws.userId);
                    sendToCallRoom(ws.callRoomId, {
                        type: 'call_peer_left',
                        roomId: ws.callRoomId,
                        peer: { userId: ws.userId }
                    }, ws.userId);
                    if (lr && lr.ok) saveCallMessage(lr).catch(() => {});
                    // Комната закрылась при дисконнекте — уведомляем pending-адресатов и зачищаем
                    if (lr && lr.closed) {
                        const _closedRoomId = ws.callRoomId;
                        for (const [uid, inv] of pendingCallInvites) {
                            if (inv.roomId === _closedRoomId) {
                                sendToUser(uid, { type: 'call_cancelled', roomId: _closedRoomId });
                                pendingCallInvites.delete(uid);
                            }
                        }
                    }
                } catch (_) {}
                ws.callRoomId = null;
            }
    
            const userConnections = connectedUsers.get(userId);
            if (userConnections) {
                userConnections.delete(ws);
                if (userConnections.size === 0) {
                    connectedUsers.delete(userId);
                    
                    // Рассылка статуса "оффлайн" — в фоне, один JOIN
                    if (userId && !userId.startsWith('anonymous')) {
                        (async () => {
                            try {
                                await query('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = $1', [userId]);
                                const res = await query(
                                    `SELECT DISTINCT cm2.user_id
                                     FROM chat_members cm1
                                     JOIN chat_members cm2 ON cm1.chat_id = cm2.chat_id AND cm2.user_id != $1
                                     WHERE cm1.user_id = $1`,
                                    [userId]
                                );
                                const statusMsg = JSON.stringify({
                                    type: 'user_status', userId, isOnline: false,
                                    lastSeen: new Date().toISOString()
                                });
                                for (const row of res.rows) {
                                    const conns = connectedUsers.get(row.user_id);
                                    if (!conns) continue;
                                    for (const c of conns) {
                                        if (c.readyState === WebSocket.OPEN) {
                                            try { c.send(statusMsg); } catch (_) {}
                                        }
                                    }
                                }
                            } catch (_) {}
                        })();
                    }
                }
            }
            logger.info('🔌 WebSocket disconnected:', userId);
        });
    
        ws.send(JSON.stringify({ type: 'connected', userId, timestamp: new Date().toISOString() }));
    });
    
    // Ping всех подключений каждые 30 секунд
    setInterval(() => {
        wss.clients.forEach(ws => {
            if (!ws.isAlive) {
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 15000); // 15 сек — меньше таймаута NAT мобильных операторов (~20-30 сек)
    
    // Доставить сообщение конкретному пользователю (всем его открытым WS-сокетам)
    function sendToUser(userId, message) {
        const conns = connectedUsers.get(userId);
        if (!conns || conns.size === 0) return false;
        const data = JSON.stringify(message);
        let sent = 0;
        for (const c of conns) {
            if (c.readyState === WebSocket.OPEN) {
                try { c.send(data); sent++; } catch (_) {}
            }
        }
        return sent > 0;
    }
    
    // Разослать всем участникам call-комнаты, кроме отправителя
    function sendToCallRoom(roomId, message, exceptUserId) {
        const room = callRoom.getRoom(roomId);
        if (!room) return;
        const data = JSON.stringify(message);
        for (const p of room.participants.values()) {
            if (p.userId === exceptUserId) continue;
            const conns = connectedUsers.get(p.userId);
            if (!conns) continue;
            for (const c of conns) {
                if (c.readyState === WebSocket.OPEN) {
                    try { c.send(data); } catch (_) {}
                }
            }
        }
    }
    
    async function broadcastToChat(chatId, message, excludeUserId) {
        try {
            const members = await query(
                'SELECT user_id FROM chat_members WHERE chat_id = $1',
                [chatId]
            );
            const memberIds = new Set(members.rows.map(r => r.user_id));
            const data = JSON.stringify(message);
            wss.clients.forEach(client => {
                if (
                    client.readyState === WebSocket.OPEN &&
                    client.userId !== excludeUserId &&
                    memberIds.has(client.userId)
                ) {
                    try { client.send(data); } catch (_) {}
                }
            });
        } catch (e) {
            logger.warn('⚠️ broadcastToChat error:', e.message);
        }
    }

    return { broadcastToChat, sendToCallRoom, sendToUser };
}

module.exports = createRealtimeGateway;

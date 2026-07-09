require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const logger = require('../services/logger');
const { pool, query, initDatabase, ensureTablesExist } = require('../../database/database');
const security = require('../middleware/security');
security.init({ query });
const i18n = require('../i18n');
const QRCode = require('qrcode');
const callRoom = require('../services/call-service/callRoom');
const createGifRoutes = require('./routes/gifRoutes');
const createEmojiRoutes = require('./routes/emojiRoutes');
const createHealthRoutes = require('./routes/healthRoutes');
const createStickerRoutes = require('./routes/stickerRoutes');
const createSpaRoutes = require('./routes/spaRoutes');
const createLoginNotificationService = require('./services/loginNotificationService');
const createGatewayStartupMigrations = require('./services/gatewayStartupMigrations');
const createRealtimeGateway = require('./services/realtimeGateway');
const createCraneAppBotService = require('./services/craneAppBotService');
const createDuplicatePrivateChatCleanup = require('./services/duplicatePrivateChatCleanup');
const registerProcessHandlers = require('./services/processHandlers');
const createAuthMiddleware = require('./middleware/authMiddleware');
const createTrafficProtectionMiddleware = require('./middleware/trafficProtectionMiddleware');
const createGatewayRateLimiters = require('./middleware/rateLimiterMiddleware');
const { createErrorHandler, notFoundHandler } = require('./middleware/errorHandlers');

const MAX_LOGIN_ATTEMPTS = 10; // синхронизировано с security.js

// Список разработчиков (загружается из переменных окружения)
const DEVELOPERS = new Set(
    (process.env.DEVELOPERS || 'adm1,admin,admin1,qzlfee')
        .split(',')
        .map(u => u.trim().toLowerCase())
);
function isDeveloper(username) {
    return DEVELOPERS.has((username || '').toLowerCase());
}

const app = express();
app.set('trust proxy', 'loopback');
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/ws')) {
        if (process.env.CHAT_URL) {
            const targetUrl = new URL(process.env.CHAT_URL);
            const proxyReq = http.request({
                hostname: targetUrl.hostname,
                port: targetUrl.port,
                path: req.url,
                method: req.method,
                headers: req.headers,
            });

            proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
                const headers = ['HTTP/1.1 101 Switching Protocols'];
                for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
                    const name = proxyRes.rawHeaders[i].toLowerCase();
                    if (name !== 'connection' && name !== 'upgrade') {
                        headers.push(`${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}`);
                    }
                }
                headers.push('Connection: Upgrade', 'Upgrade: websocket');
                socket.write(headers.join('\r\n') + '\r\n\r\n');
                if (proxyHead && proxyHead.length) socket.write(proxyHead);
                proxySocket.pipe(socket);
                socket.pipe(proxySocket);
                socket.on('close', () => proxySocket.destroy());
                proxySocket.on('close', () => socket.destroy());
            });

            proxyReq.on('error', (err) => {
                logger.warn('WebSocket proxy fallback to Node:', err.message);
                wss.handleUpgrade(req, socket, head, (ws) => {
                    wss.emit('connection', ws, req);
                });
            });

            proxyReq.end();
        } else {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        }
    } else {
        socket.destroy();
    }
});

global.wss = wss;

// ============================================
// ANTI-DDOS & SECURITY
// ============================================

// Helmet — базовые HTTP-заголовки безопасности
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000'];
const wsOrigins = allowedOrigins.map(o => o.replace(/^http/, 'ws'));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://i.ibb.co'],
            mediaSrc: ["'self'", 'blob:'],
            connectSrc: ["'self'", ...allowedOrigins, ...wsOrigins, 'wss:', 'ws:'],
            workerSrc: ["'self'", 'blob:'],
            fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'self'"],
            formAction: ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'sameorigin' },
    hsts: process.env.NODE_ENV !== 'development'
}));

const trafficProtection = createTrafficProtectionMiddleware({ i18n, logger });
const {
    bodySizeMiddleware,
    floodDetectionMiddleware,
    ipBlockMiddleware,
    suspiciousUAMiddleware,
    wsConnections,
} = trafficProtection;
const { apiLimiter, authLimiter, globalLimiter, uploadLimiter } = createGatewayRateLimiters({
    i18n,
    logger,
    query,
    rateLimit,
    trafficProtection,
});

// Применяем middleware в правильном порядке
app.use(ipBlockMiddleware);
app.use(floodDetectionMiddleware);
app.use(suspiciousUAMiddleware);
app.use(bodySizeMiddleware);
app.use(globalLimiter);
// Extra security headers not covered by Helmet
app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// Security middleware
app.use(security.securityHeadersMiddleware);
app.use(security.suspiciousIPMiddleware);
app.use(security.pathTraversalMiddleware);
app.use(security.paramPollutionMiddleware);
app.use(security.xssMiddleware);
app.use(security.tokenRevocationMiddleware);
app.use(security.validateContentType);

// ============================================
// UPLOAD DIRECTORY
// ============================================
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const mediaDir = path.join(uploadsDir, 'media');
if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
}

const stickersDir = path.join(uploadsDir, 'stickers');
if (!fs.existsSync(stickersDir)) {
    fs.mkdirSync(stickersDir, { recursive: true });
}

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Crane-Language']
}));

app.use((req, res, next) => {
    const largePaths = [
        '/api/v2/upload',
        '/api/v2/stickers/packs',
        '/api/v2/users/profile',
        '/api/v2/users/avatar',
        '/api/v2/chats/groups',
        '/api/v2/chats/'
    ];
    const isLarge = largePaths.some(p => req.path.startsWith(p));
    const limit = isLarge ? '100mb' : '2mb';
    express.json({ limit })(req, res, next);
});

app.use((req, res, next) => {
    const largePaths = [
        '/api/v2/upload',
        '/api/v2/stickers/packs',
        '/api/v2/users/profile',
        '/api/v2/users/avatar',
        '/api/v2/chats/groups',
        '/api/v2/chats/'
    ];
    const isLarge = largePaths.some(p => req.path.startsWith(p));
    const limit = isLarge ? '100mb' : '2mb';
    express.urlencoded({ extended: true, limit })(req, res, next);
});

app.use(i18n.middleware({ query, jwt, secret: process.env.JWT_SECRET }));
app.use(security.massAssignmentMiddleware);
app.use(security.sqlInjectionMiddleware);

// Применяем API лимит ко всем /api/ роутам
app.use('/api/', apiLimiter);

app.use('/client', express.static(path.join(__dirname, '../../client')));
app.use('/uploads', express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
        if (/\.(webm|ogg|m4a|mp3)$/i.test(filePath)) {
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));
app.use(express.static(path.join(__dirname, '../../dist')));
app.use(express.static(path.join(__dirname, '../../public')));

// Simple file upload handler
function handleFileUpload(base64Data, type, subDir = 'media') {
    const dir = subDir === 'stickers' ? stickersDir : mediaDir;
    
    let ext = 'jpg';
    if (base64Data.startsWith('data:image/png')) ext = 'png';
    else if (base64Data.startsWith('data:image/gif')) ext = 'gif';
    else if (base64Data.startsWith('data:video/')) ext = 'mp4';
    else if (base64Data.startsWith('data:image/webp')) ext = 'webp';
    else if (base64Data.startsWith('data:audio/webm')) ext = 'webm';
    else if (base64Data.startsWith('data:audio/ogg')) ext = 'ogg';
    else if (base64Data.startsWith('data:audio/mp4')) ext = 'm4a';
    else if (base64Data.startsWith('data:audio/mpeg')) ext = 'mp3';
    else if (base64Data.startsWith('data:audio/')) ext = 'webm';
    
    const filename = uuidv4() + '.' + ext;
    const filepath = path.join(dir, filename);
    
    // Remove data URL prefix
    const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Content, 'base64');
    
    fs.writeFileSync(filepath, buffer);
    
    return `/uploads/${subDir}/${filename}`;
}

// ============================================
// ГЛАВНАЯ СТРАНИЦА
// ============================================

app.use(createSpaRoutes({ distDir: path.join(__dirname, '../../dist') }));

// ============================================
// VIDEO CALLS — REST ENDPOINTS
// ============================================

// Конфиг ICE-серверов: STUN + TURN (Metered или ручные ENV)
let _cachedIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

async function _refreshMeteredTurn() {
    const servers = await fetchTurnCredentials();
    if (Array.isArray(servers) && servers.length > 0) {
        _cachedIceServers = servers;
        logger.info(`📡 TURN credentials refreshed from Metered (${servers.length} servers)`);
    }
}

async function fetchTurnCredentials() {
    const apiKey = process.env.METERED_API_KEY;
    const domain = process.env.METERED_DOMAIN;
    if (!apiKey || !domain) return null;

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000); // таймаут 8 сек

    try {
        const res = await fetch(`https://${domain}/api/v2/turn/credentials?apiKey=${apiKey}`, { signal: ctrl.signal });
        clearTimeout(tid);
        const body = await res.text();

        if (!res.ok) {
            return { status: res.status, ok: false, body: body.slice(0, 500) };
        }

        try {
            return JSON.parse(body);
        } catch (_) {
            return { status: res.status, ok: true, body: body.slice(0, 500) };
        }
    } catch (error) {
        clearTimeout(tid);
        logger.warn('TURN refresh failed:', error.message);
        return { error: error.message };
    }
}

// Обновляем при старте (с задержкой 3с чтобы не мешать запуску) и каждые 12 часов
setTimeout(_refreshMeteredTurn, 3000);
setInterval(_refreshMeteredTurn, 12 * 60 * 60 * 1000);

function getIceServers() {
    const ice = [..._cachedIceServers];
    // Ручные TURN через ENV (если Metered не используется)
    if (!process.env.METERED_API_KEY && process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
        ice.push({
            urls: process.env.TURN_URL,
            username: process.env.TURN_USERNAME,
            credential: process.env.TURN_CREDENTIAL
        });
    }
    return ice;
}

// Простая JWT-проверка из Authorization (без middleware-цепочки)
async function authFromHeader(req) {
    try {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) return null;
        const token = auth.slice(7);
        if (!process.env.JWT_SECRET) return null;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return decoded;
    } catch (_) { return null; }
}

// Сохранить системное сообщение о завершённом звонке
async function saveCallMessage(r) {
    if (!r || !r.closed || !r.chatId) return;
    try {
        const status = r.answeredAt ? 'answered' : 'missed';
        const duration = r.answeredAt ? Math.floor((Date.now() - r.answeredAt) / 1000) : 0;
        const content = JSON.stringify({ callKind: r.callKind || 'video', status, duration, initiatorId: r.hostId });
        const msgId = uuidv4();
        const result = await query(
            `INSERT INTO messages (id, chat_id, sender_id, content, type, created_at)
             VALUES ($1, $2, $3, $4, 'call', NOW()) RETURNING *`,
            [msgId, r.chatId, r.hostId, content]
        );
        const msg = result.rows[0];
        if (msg) {
            broadcastToChat(r.chatId, {
                type: 'new_message',
                chatId: r.chatId,
                chatType: 'private',
                message: { ...msg, type: 'call' }
            }, null);
        }
    } catch (e) {
        logger.warn('⚠️ saveCallMessage error:', e.message);
    }
}
app.use('/api/v2/calls', createV2Proxy('CHAT_URL', '/api/v2/calls', 'Calls'));

app.use('/api', createHealthRoutes({ wss }));

const authMiddleware = createAuthMiddleware({ i18n, jwt, logger, query });

const realtimeGateway = createRealtimeGateway({
    callRoom,
    jwt,
    jwtSecret: process.env.JWT_SECRET,
    logger,
    query,
    saveCallMessage,
    WebSocket,
    WS_CONNECTIONS: wsConnections,
    wss,
});
const { broadcastToChat, sendToCallRoom, sendToUser } = realtimeGateway;

const botService = createCraneAppBotService({
    bcrypt,
    broadcastToChat,
    DEVELOPERS,
    i18n,
    isDeveloper,
    logger,
    query,
    security,
    uuidv4,
});
const { createCraneAppBotChat, handleBotCommand } = botService;

// ============================================
// AUTO MIGRATE
// ============================================

const startupMigrations = createGatewayStartupMigrations({
    logger,
    query,
});
const duplicateChatCleanup = createDuplicatePrivateChatCleanup({
    createCraneAppBotChat,
    logger,
    query,
});

const loginNotifications = createLoginNotificationService({
    i18n,
    logger,
    query,
    uuidv4,
    WebSocket,
    wss,
});

function createV2Proxy(envVar, basePath, name) {
    if (!process.env[envVar]) return (req, res, next) => next();
    const target = process.env[envVar].replace(/\/$/, '');
    return async (req, res, next) => {
        try {
            const qs = Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '';
            const url = `${target}${basePath}${req.path === '/' ? '' : req.path}${qs}`;
            const headers = {
                'accept-language': req.headers['accept-language'] || '',
                'x-forwarded-for': req.ip || '',
            };
            if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
            if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
            if (req.headers.authorization) headers.authorization = req.headers.authorization;

            let body;
            let duplex;
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
                    body = req;
                    duplex = 'half';
                } else if (req.body && Object.keys(req.body).length > 0) {
                    body = JSON.stringify(req.body);
                }
            }

            const upstream = await fetch(url, { method: req.method, headers, body, duplex, signal: AbortSignal.timeout(15000) });
            const contentType = upstream.headers.get('content-type') || '';
            res.status(upstream.status);
            upstream.headers.forEach((v, k) => {
                if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
            });
            if (contentType.includes('application/json')) {
                res.json(await upstream.json());
            } else {
                res.send(await upstream.text());
            }
        } catch (err) {
            logger.warn(`${name} proxy fallback to Node:`, err.message);
            next();
        }
    };
}

app.use('/api/v2/chats', createV2Proxy('CHAT_URL', '/api/v2/chats', 'Chat'));
app.use('/api/v2/messages', createV2Proxy('CHAT_URL', '/api/v2/messages', 'Messages'));
app.use('/api/v2/mls', createV2Proxy('CHAT_URL', '/api/v2/mls', 'MLS'));
app.use('/api/v2/auth', createV2Proxy('AUTH_URL', '/api/v2/auth', 'Auth'));
app.use('/api/v2/users', createV2Proxy('USER_URL', '/api/v2/users', 'User'));
app.use('/api/v2/encryption', createV2Proxy('USER_URL', '/api/v2/encryption', 'Encryption'));
app.use('/api/v2/support', createV2Proxy('USER_URL', '/api/v2/support', 'Support'));
app.use('/api/v2/media', createV2Proxy('MEDIA_URL', '/api/v2/media', 'Media'));
app.use('/api/v2/moderation', createV2Proxy('USER_URL', '/api/v2/moderation', 'Moderation'));
app.use('/api/v2/reports', createV2Proxy('USER_URL', '/api/v2/reports', 'Reports'));


app.use('/api/v2/stickers', createStickerRoutes({
    authMiddleware,
    handleFileUpload,
    logger,
    projectRoot: path.join(__dirname, '../..'),
    query,
    uuidv4,
}));

app.use('/api/v2/gifs', createGifRoutes({
    authMiddleware,
    logger,
    query,
    uuidv4,
}));

app.use('/api/v2/emojis', createEmojiRoutes({
    applemojis: require('applemojis'),
}));

// WEBSOCKET
// ============================================

// ============================================
// HEALTH & ERROR HANDLING
// ============================================

// ============================================
// SUPPORT REQUESTS API
// ============================================

app.use(createErrorHandler({ logger }));
app.use(notFoundHandler);

// ============================================
// START SERVER
// ============================================

const PORT = process.env.NODE_PORT || process.env.PORT || 3000;

async function start() {
    try {
        console.log('[START] Starting server initialization...');
        console.log('[START] PORT:', PORT);
        console.log('[START] NODE_ENV:', process.env.NODE_ENV);
        console.log('[START] DATABASE_URL exists:', !!process.env.DATABASE_URL);

        await initDatabase();
        console.log('[START] Database initialized');
        await ensureTablesExist();
        console.log('[START] Tables ensured');
        await startupMigrations.autoMigrate();
        
        // Очищаем дубликаты при запуске
        await duplicateChatCleanup.cleanDuplicatePrivateChats();
        
        server.listen(PORT, () => {
            logger.info('========================================');
            logger.info('🦢 CraneApp server running on port ' + PORT);
            logger.info('🌐 Environment: ' + (process.env.NODE_ENV || 'development'));
            logger.info('🔗 Local: http://localhost:' + PORT);
            logger.info('📁 Uploads: ' + uploadsDir);
            logger.info('========================================');
        });
    } catch (error) {
        logger.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    start();
    registerProcessHandlers({ logger, pool, server });
}

module.exports = { app, server, wss, start };

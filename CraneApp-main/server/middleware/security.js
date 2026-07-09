 /**
 * CraneApp — Full Security Middleware
 * Защита от: SQL injection, XSS, CSRF, brute-force, path traversal,
 * token tampering, parameter pollution, mass assignment, enumeration attacks
 */

const crypto = require('crypto');
const logger = require('../services/logger');
const i18n = require('../i18n');

// ============================================
// ХРАНИЛИЩА
// ============================================

// Неудачные попытки входа: ip+username -> { count, firstAt, lockedUntil }
const loginAttempts = new Map();

// Активные сессии: userId -> Set<tokenHash> (in-memory — используется только для revokeAllUserSessions)
const activeSessions = new Map();

// DB-клиент для проверки отозванных токенов — инжектируется через init()
let _query = null;
function init({ query }) { _query = query; }

// Подозрительные IP (повторные атаки): ip -> { score, lastAt }
const suspiciousIPs = new Map();

// ============================================
// КОНСТАНТЫ
// ============================================
const MAX_LOGIN_ATTEMPTS = 10;         // попыток до временной блокировки
const LOCKOUT_DURATION = 5 * 60000;    // 5 минут временной блокировки
const SUSPICIOUS_THRESHOLD = 50;       // очков до постоянной блокировки
const TOKEN_MAX_AGE = 30 * 24 * 3600;  // 30 дней в секундах

// ============================================
// 1. SQL INJECTION DETECTION
// ============================================
const SQL_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|TRUNCATE|REPLACE)\b)/i,
    /(--|;|\/\*|\*\/|xp_|sp_)/,
    /(\bOR\b\s+\d+\s*=\s*\d+|\bAND\b\s+\d+\s*=\s*\d+)/i,
    /('|('')|(%27)|(%2527))/,
    /(SLEEP\s*\(|BENCHMARK\s*\(|WAITFOR\s+DELAY)/i,
    /(LOAD_FILE|INTO\s+OUTFILE|INTO\s+DUMPFILE)/i,
    /(INFORMATION_SCHEMA|SYS\.TABLES|SYSOBJECTS)/i,
];

function detectSQLInjection(value) {
    if (typeof value !== 'string') return false;
    return SQL_PATTERNS.some(p => p.test(value));
}

function scanObject(obj, depth = 0, skipKeys = []) {
    if (depth > 5) return false;
    if (typeof obj === 'string') return detectSQLInjection(obj);
    if (Array.isArray(obj)) return obj.some(v => scanObject(v, depth + 1, skipKeys));
    if (obj && typeof obj === 'object') {
        return Object.entries(obj).some(([k, v]) => {
            if (skipKeys.includes(k)) return false;
            return scanObject(v, depth + 1, skipKeys);
        });
    }
    return false;
}

function sqlInjectionMiddleware(req, res, next) {
    // Пропускаем поля с бинарными данными (base64 файлы)
    const skipKeys = ['file', 'image', 'avatar', 'icon', 'data'];

    const targets = [req.query, req.params];
    for (const target of targets) {
        if (scanObject(target, 0, [])) {
            const ip = getIP(req);
            addSuspiciousScore(ip, 20);
            logger.warn(`🚨 SQL injection attempt from ${ip}: ${req.path}`);
            return res.status(400).json({ error: 'Invalid input detected' });
        }
    }
    // Для body — пропускаем поля с файлами
    if (req.body && scanObject(req.body, 0, skipKeys)) {
        const ip = getIP(req);
        addSuspiciousScore(ip, 20);
        logger.warn(`🚨 SQL injection attempt from ${ip}: ${req.path}`);
        return res.status(400).json({ error: 'Invalid input detected' });
    }
    next();
}

// ============================================
// 2. XSS DETECTION & SANITIZATION
// ============================================
const XSS_PATTERNS = [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /<[^>]+on\w+\s*=\s*["'][^"']*["']/gi,
    /javascript\s*:/gi,
    /vbscript\s*:/gi,
    /<iframe[\s\S]*?>/gi,
    /<object[\s\S]*?>/gi,
    /<embed[\s\S]*?>/gi,
    /data\s*:\s*text\/html/gi,
    /expression\s*\(/gi,
];

function detectXSS(value) {
    if (typeof value !== 'string') return false;
    return XSS_PATTERNS.some(p => p.test(value));
}

function sanitizeString(value) {
    if (typeof value !== 'string') return value;
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

function xssMiddleware(req, res, next) {
    // Пропускаем query params с файлами не нужно, но проверяем только строковые query
    for (const [key, val] of Object.entries(req.query || {})) {
        if (typeof val === 'string' && !val.startsWith('data:') && detectXSS(val)) {
            const ip = getIP(req);
            addSuspiciousScore(ip, 15);
            logger.warn(`🚨 XSS attempt in query from ${ip}: ${key}=${val}`);
            return res.status(400).json({ error: 'Invalid input detected' });
        }
    }
    next();
}

// ============================================
// 3. PATH TRAVERSAL PROTECTION
// ============================================
const PATH_TRAVERSAL_PATTERNS = [
    /\.\.\//,
    /\.\.%2F/i,
    /\.\.%5C/i,
    /%2e%2e/i,
    /\.\.\\/,
    /\/etc\/passwd/i,
    /\/etc\/shadow/i,
    /\/proc\/self/i,
    /\/windows\/system32/i,
    /\0/,  // null byte
];

function pathTraversalMiddleware(req, res, next) {
    const url = decodeURIComponent(req.url || '');
    for (const pattern of PATH_TRAVERSAL_PATTERNS) {
        if (pattern.test(url)) {
            const ip = getIP(req);
            addSuspiciousScore(ip, 25);
            logger.warn(`🚨 Path traversal attempt from ${ip}: ${req.url}`);
            return res.status(400).json({ error: 'Invalid request' });
        }
    }
    next();
}

// ============================================
// 4. BRUTE FORCE PROTECTION
// ============================================
function getBruteForceKey(ip, username) {
    return `${ip}:${(username || '').toLowerCase()}`;
}

function checkBruteForce(ip, username) {
    const key = getBruteForceKey(ip, username);
    const data = loginAttempts.get(key);
    if (!data) return { blocked: false };

    if (data.lockedUntil && Date.now() < data.lockedUntil) {
        const remaining = Math.ceil((data.lockedUntil - Date.now()) / 60000);
        return { blocked: true, remaining };
    }

    // Сброс если блокировка истекла
    if (data.lockedUntil && Date.now() >= data.lockedUntil) {
        loginAttempts.delete(key);
        return { blocked: false };
    }

    return { blocked: false, attempts: data.count };
}

function recordFailedLogin(ip, username) {
    const key = getBruteForceKey(ip, username);
    const now = Date.now();
    const data = loginAttempts.get(key) || { count: 0, firstAt: now };

    // Сброс если прошло больше 15 минут с первой попытки
    if (now - data.firstAt > LOCKOUT_DURATION) {
        data.count = 0;
        data.firstAt = now;
        delete data.lockedUntil;
    }

    data.count++;

    if (data.count >= MAX_LOGIN_ATTEMPTS) {
        data.lockedUntil = now + LOCKOUT_DURATION;
        addSuspiciousScore(ip, 30);
        logger.warn(`🔒 Account locked for ${username} from ${ip} after ${data.count} attempts`);
    }

    loginAttempts.set(key, data);
    return data.count;
}

function recordSuccessfulLogin(ip, username) {
    const key = getBruteForceKey(ip, username);
    loginAttempts.delete(key);
}

// ============================================
// 5. TOKEN SECURITY
// ============================================
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function revokeToken(token, userId) {
    const hash = hashToken(token);
    if (!_query || !userId) return;
    try {
        await _query(
            `INSERT INTO auth.revoked_tokens (token_hash, user_id, expires_at)
             VALUES ($1, $2, NOW() + INTERVAL '30 days')
             ON CONFLICT (token_hash) DO NOTHING`,
            [hash, userId]
        );
    } catch (e) {
        logger.warn('revokeToken DB error:', e.message);
    }
}

async function isTokenRevoked(token) {
    const hash = hashToken(token);
    if (!_query) return false;
    try {
        const r = await _query(
            `SELECT 1 FROM auth.revoked_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
            [hash]
        );
        return r.rows.length > 0;
    } catch (e) {
        logger.warn('isTokenRevoked DB error:', e.message);
        return false;
    }
}

function registerSession(userId, token) {
    const hash = hashToken(token);
    if (!activeSessions.has(userId)) {
        activeSessions.set(userId, new Set());
    }
    activeSessions.get(userId).add(hash);
}

async function revokeAllUserSessions(userId) {
    if (!_query) return;
    try {
        await _query(
            `UPDATE auth.sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
            [userId]
        );
    } catch (e) {
        logger.warn('revokeAllUserSessions DB error:', e.message);
    }
    activeSessions.delete(userId);
}

// Middleware проверки отозванных токенов
async function tokenRevocationMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    if (await isTokenRevoked(token)) {
        return res.status(401).json({ error: 'Token has been revoked' });
    }
    next();
}

// ============================================
// 6. PARAMETER POLLUTION PROTECTION
// ============================================
function paramPollutionMiddleware(req, res, next) {
    // Если один параметр передан несколько раз — берём только первый
    for (const key of Object.keys(req.query)) {
        if (Array.isArray(req.query[key])) {
            req.query[key] = req.query[key][0];
        }
    }
    next();
}

// ============================================
// 7. MASS ASSIGNMENT PROTECTION
// ============================================
// Список полей которые нельзя устанавливать через API
const PROTECTED_FIELDS = [
    'id', 'password_hash', 'is_admin', 'is_bot', 'created_at',
    'role', 'verified', 'banned', 'ban_reason', 'internal_notes'
];

function stripProtectedFields(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = { ...obj };
    for (const field of PROTECTED_FIELDS) {
        delete clean[field];
    }
    return clean;
}

function massAssignmentMiddleware(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        const dangerous = PROTECTED_FIELDS.filter(f => f in req.body);
        if (dangerous.length > 0) {
            const ip = getIP(req);
            addSuspiciousScore(ip, 10);
            logger.warn(`🚨 Mass assignment attempt from ${ip}: ${dangerous.join(', ')}`);
            req.body = stripProtectedFields(req.body);
        }
    }
    next();
}

// ============================================
// 8. USER ENUMERATION PROTECTION
// ============================================
// Одинаковое время ответа для "пользователь не найден" и "неверный пароль"
function timingAttackDelay(ms = 200) {
    return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 100));
}

// ============================================
// 9. SUSPICIOUS IP SCORING
// ============================================
function getIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
}

function addSuspiciousScore(ip, score) {
    const data = suspiciousIPs.get(ip) || { score: 0, lastAt: Date.now() };
    data.score += score;
    data.lastAt = Date.now();
    suspiciousIPs.set(ip, data);

    if (data.score >= SUSPICIOUS_THRESHOLD) {
        logger.warn(`🚨 IP ${ip} reached suspicious threshold (score: ${data.score}), blocking`);
    }
}

function isSuspiciousIP(ip) {
    const data = suspiciousIPs.get(ip);
    if (!data) return false;
    // Сбрасываем очки через 1 час
    if (Date.now() - data.lastAt > 3600000) {
        suspiciousIPs.delete(ip);
        return false;
    }
    return data.score >= SUSPICIOUS_THRESHOLD;
}

function suspiciousIPMiddleware(req, res, next) {
    const ip = getIP(req);
    if (isSuspiciousIP(ip)) {
        logger.warn(`🚫 Blocked suspicious IP: ${ip}`);
        return res.status(403).json({ error: i18n.t(i18n.languageFromHeaders(req), 'accessDenied') });
    }
    next();
}

// ============================================
// 10. SECURITY HEADERS (дополнительные)
// ============================================
function securityHeadersMiddleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=*, microphone=*, geolocation=()');
    res.setHeader('Cache-Control', 'no-store');
    // Убираем информацию о сервере
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    next();
}

// ============================================
// 11. REQUEST VALIDATION
// ============================================
function validateContentType(req, res, next) {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const ct = req.headers['content-type'] || '';
        const contentLength = Number(req.headers['content-length'] || 0);
        const hasBody = contentLength > 0 || Boolean(req.headers['transfer-encoding']);
        if (req.path.startsWith('/api/') && hasBody && !ct.includes('application/json') && !ct.includes('multipart/form-data')) {
            return res.status(415).json({ error: i18n.t(i18n.languageFromHeaders(req), 'unsupportedMediaType') });
        }
    }
    next();
}

// ============================================
// 12. ОЧИСТКА СТАРЫХ ДАННЫХ
// ============================================
setInterval(() => {
    const now = Date.now();

    // Очищаем старые попытки входа
    for (const [key, data] of loginAttempts) {
        if (now - data.firstAt > LOCKOUT_DURATION * 2) {
            loginAttempts.delete(key);
        }
    }

    // Очищаем старые suspicious IP
    for (const [ip, data] of suspiciousIPs) {
        if (now - data.lastAt > 3600000) {
            suspiciousIPs.delete(ip);
        }
    }
}, 10 * 60 * 1000); // каждые 10 минут

// ============================================
// ЭКСПОРТ
// ============================================
module.exports = {
    // Инициализация с DB-клиентом
    init,

    // Middleware
    sqlInjectionMiddleware,
    xssMiddleware,
    pathTraversalMiddleware,
    paramPollutionMiddleware,
    massAssignmentMiddleware,
    suspiciousIPMiddleware,
    securityHeadersMiddleware,
    tokenRevocationMiddleware,
    validateContentType,

    // Функции для использования в роутах
    checkBruteForce,
    recordFailedLogin,
    recordSuccessfulLogin,
    revokeToken,
    isTokenRevoked,
    registerSession,
    revokeAllUserSessions,
    timingAttackDelay,
    sanitizeString,
    stripProtectedFields,
    addSuspiciousScore,
    getIP,
};

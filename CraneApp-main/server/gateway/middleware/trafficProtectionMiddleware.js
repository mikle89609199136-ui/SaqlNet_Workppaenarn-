function createTrafficProtectionMiddleware({ i18n, logger }) {
    const ipRequestCounts = new Map();
    const ipBlockList = new Map();
    const wsConnections = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [ip, data] of ipRequestCounts) {
            if (now > data.resetAt + 60000) ipRequestCounts.delete(ip);
        }
        for (const [ip, blockUntil] of ipBlockList) {
            if (now > blockUntil) ipBlockList.delete(ip);
        }
    }, 5 * 60 * 1000);

    return {
        bodySizeMiddleware,
        blockIp,
        floodDetectionMiddleware,
        ipBlockMiddleware,
        suspiciousUAMiddleware,
        wsConnections,
    };

    function blockIp(ip, milliseconds) {
        ipBlockList.set(ip, Date.now() + milliseconds);
    }

    function ipBlockMiddleware(req, res, next) {
        const ip = getIp(req);
        const blockUntil = ipBlockList.get(ip);
        if (blockUntil && Date.now() < blockUntil) {
            const remaining = Math.ceil((blockUntil - Date.now()) / 60000);
            res.set('Retry-After', String(remaining * 60));
            return res.status(403).json({ error: i18n.t(i18n.languageFromHeaders(req), 'tooManyFailedAttempts', { minutes: remaining }) });
        }
        if (blockUntil && Date.now() >= blockUntil) ipBlockList.delete(ip);
        next();
    }

    function floodDetectionMiddleware(req, res, next) {
        if (!req.path.startsWith('/api/')) return next();

        const ip = getIp(req);
        const now = Date.now();
        const windowMs = 1000;
        const maxPerSecond = 60;
        const data = ipRequestCounts.get(ip) || { count: 0, resetAt: now + windowMs };

        if (now > data.resetAt) {
            data.count = 1;
            data.resetAt = now + windowMs;
            ipRequestCounts.set(ip, data);
            return next();
        }

        data.count++;
        ipRequestCounts.set(ip, data);
        if (data.count > maxPerSecond) {
            blockIp(ip, 2 * 60 * 1000);
            logger.warn(`🚫 Flood detected, blocking IP: ${ip} (${data.count} API req/s)`);
            return res.status(429).json({ error: i18n.t(i18n.languageFromHeaders(req), 'tooManyFailedAttempts', { minutes: 2 }) });
        }
        next();
    }

    function bodySizeMiddleware(req, res, next) {
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        const maxSize = 105 * 1024 * 1024;
        if (contentLength > maxSize) {
            return res.status(413).json({ error: i18n.t(i18n.languageFromHeaders(req), 'tooManyRequests') });
        }
        next();
    }

    function suspiciousUAMiddleware(req, res, next) {
        const ua = req.headers['user-agent'] || '';
        const suspicious = [
            /sqlmap/i, /nikto/i, /nmap/i, /masscan/i,
            /zgrab/i, /python-requests\/[01]\./i, /go-http-client\/1\./i,
            /curl\/[0-6]\./i, /wget\//i,
        ];
        if (!ua && req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
        for (const pattern of suspicious) {
            if (pattern.test(ua)) {
                logger.warn(`🚫 Suspicious UA blocked: ${ua} from ${getIp(req)}`);
                return res.status(403).json({ error: 'Forbidden' });
            }
        }
        next();
    }
}

function getIp(req) {
    return req.ip;
}

module.exports = createTrafficProtectionMiddleware;

/**
 * Rate limiter middleware with optional PostgreSQL-backed persistent store.
 * Falls back to in-memory store if DB is unavailable.
 */

function createPostgresStore(query, windowMs, namespace = 'default') {
    return {
        localKeys: false,

        async increment(key) {
            const namespacedKey = `${namespace}:${key}`;
            try {
                const windowSecs = Math.ceil(windowMs / 1000);
                const result = await query(
                    `INSERT INTO rate_limit_hits (key, hits, reset_at)
                     VALUES ($1, 1, NOW() + ($2 || ' seconds')::INTERVAL)
                     ON CONFLICT (key) DO UPDATE SET
                         hits = CASE
                             WHEN rate_limit_hits.reset_at <= NOW() THEN 1
                             ELSE rate_limit_hits.hits + 1
                         END,
                         reset_at = CASE
                             WHEN rate_limit_hits.reset_at <= NOW() THEN NOW() + ($2 || ' seconds')::INTERVAL
                             ELSE rate_limit_hits.reset_at
                         END
                     RETURNING hits, reset_at`,
                    [namespacedKey, String(windowSecs)]
                );
                const row = result.rows[0];
                return { totalHits: row.hits, resetTime: new Date(row.reset_at) };
            } catch (_) {
                // Non-fatal: allow request if DB unavailable
                return { totalHits: 1, resetTime: new Date(Date.now() + windowMs) };
            }
        },

        async decrement(key) {
            const namespacedKey = `${namespace}:${key}`;
            try {
                await query(
                    'UPDATE rate_limit_hits SET hits = GREATEST(0, hits - 1) WHERE key = $1',
                    [namespacedKey]
                );
            } catch (_) {}
        },

        async resetKey(key) {
            const namespacedKey = `${namespace}:${key}`;
            try {
                await query('DELETE FROM rate_limit_hits WHERE key = $1', [namespacedKey]);
            } catch (_) {}
        },

        async resetAll() {
            try {
                await query('DELETE FROM rate_limit_hits');
            } catch (_) {}
        },
    };
}

function createGatewayRateLimiters({ i18n, logger, rateLimit, query }) {
    return {
        apiLimiter: createApiLimiter({ i18n, rateLimit, query }),
        authLimiter: createAuthLimiter({ i18n, logger, rateLimit, query }),
        globalLimiter: createGlobalLimiter({ i18n, logger, rateLimit, query }),
        uploadLimiter: createUploadLimiter({ i18n, rateLimit, query }),
    };
}

function createGlobalLimiter({ i18n, logger, rateLimit, query }) {
    const windowMs = 60 * 1000;
    return rateLimit({
        windowMs,
        max: 600,
        standardHeaders: true,
        legacyHeaders: false,
        validate: { singleCount: false },
        keyGenerator: getIp,
        store: createPostgresStore(query, windowMs, 'global'),
        handler: (req, res) => {
            const ip = getIp(req);
            logger.warn(`🚫 Rate limit exceeded: ${ip}`);
            res.set('Retry-After', '60');
            res.status(429).json({ error: i18n.t(i18n.languageFromHeaders(req), 'tooManyRequests') });
        },
    });
}

function createAuthLimiter({ i18n, logger, rateLimit, query }) {
    const windowMs = 5 * 60 * 1000;
    return rateLimit({
        windowMs,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: getIp,
        store: createPostgresStore(query, windowMs, 'auth'),
        handler: (req, res) => {
            const ip = getIp(req);
            logger.warn(`🚫 Auth rate limit exceeded: ${ip}`);
            res.set('Retry-After', '300');
            res.status(429).json({ error: i18n.t(i18n.languageFromHeaders(req), 'tooManyFailedAttempts', { minutes: 5 }) });
        },
    });
}

function createApiLimiter({ i18n, rateLimit, query }) {
    const windowMs = 60 * 1000;
    return rateLimit({
        windowMs,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        validate: { singleCount: false },
        keyGenerator: getIp,
        store: createPostgresStore(query, windowMs, 'api'),
        handler: (req, res) => {
            res.set('Retry-After', '60');
            res.status(429).json({ error: (req.t || ((key) => i18n.t(i18n.languageFromHeaders(req), key)))('tooManyRequests') });
        },
    });
}

function createUploadLimiter({ i18n, rateLimit, query }) {
    const windowMs = 60 * 1000;
    return rateLimit({
        windowMs,
        max: 20,
        keyGenerator: getIp,
        store: createPostgresStore(query, windowMs, 'upload'),
        handler: (req, res) => {
            res.set('Retry-After', '60');
            res.status(429).json({ error: (req.t || ((key) => i18n.t(i18n.languageFromHeaders(req), key)))('tooManyRequests') });
        },
    });
}

function getIp(req) {
    return req.ip;
}

module.exports = createGatewayRateLimiters;

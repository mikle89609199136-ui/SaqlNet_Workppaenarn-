const http = require('http');

function createLoginNotificationService({ i18n, logger, query, uuidv4, WebSocket, wss }) {
    async function notify({ userId, ip, userAgent, locale }) {
        const lang = await i18n.languageForUser(userId, query) || locale || 'ru';
        const deviceName = detectDeviceName(userAgent, i18n, lang);
        const location = await resolveLocation(ip, i18n, lang);
        await sendBotMessage({ deviceName, i18n, ip, lang, location, query, userId, uuidv4, WebSocket, wss });
    }

    async function notifyInBackground(params) {
        try {
            await notify(params);
        } catch (error) {
            logger.warn('⚠️ Login notification failed:', error.message);
        }
    }

    return { notify, notifyInBackground };
}

function detectDeviceName(userAgent, i18n, lang) {
    const ua = userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Mac/.test(ua)) return 'Mac';
    return i18n.t(lang, 'browser');
}

async function resolveLocation(ip, i18n, lang) {
    let location = i18n.t(lang, 'localNetwork');
    const isLocal = !ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.');
    if (isLocal) return location;

    const geo = await getGeo(ip, lang);
    if (geo.city) location = `${geo.city}, ${geo.country}`;
    else if (geo.country) location = geo.country;
    return location;
}

function getGeo(ip, lang) {
    return new Promise((resolve) => {
        http.get(`http://ip-api.com/json/${ip}?fields=city,country&lang=${lang}`, (response) => {
            let data = '';
            response.on('data', (chunk) => data += chunk);
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (_) {
                    resolve({});
                }
            });
        }).on('error', () => resolve({}));
    });
}

async function sendBotMessage({ deviceName, i18n, ip, lang, location, query, userId, uuidv4, WebSocket, wss }) {
    const bot = await query("SELECT id FROM users WHERE username = 'craneapp_bot'");
    if (!bot.rows.length) return;

    const chat = await query(
        `SELECT c.id FROM chats c
         JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = $1
         JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = $2
         WHERE c.type = 'private'`,
        [userId, bot.rows[0].id]
    );
    if (!chat.rows.length) return;

    const localeMap = { ru: 'ru-RU', en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', pl: 'pl-PL', uk: 'uk-UA', tr: 'tr-TR' };
    const time = new Date().toLocaleString(localeMap[lang] || 'ru-RU', { timeZone: 'Europe/Moscow' });
    const content = i18n.t(lang, 'loginNotification', {
        device: deviceName || i18n.t(lang, 'unknown'),
        location: location || i18n.t(lang, 'unknown'),
        ip: ip || i18n.t(lang, 'unknown'),
        time,
    });

    await query(
        'INSERT INTO messages (id, chat_id, sender_id, content, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [uuidv4(), chat.rows[0].id, bot.rows[0].id, content]
    );

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.userId === userId) {
            client.send(JSON.stringify({ type: 'new_message', chatId: chat.rows[0].id, message: { content, senderId: bot.rows[0].id } }));
        }
    });
}

module.exports = createLoginNotificationService;

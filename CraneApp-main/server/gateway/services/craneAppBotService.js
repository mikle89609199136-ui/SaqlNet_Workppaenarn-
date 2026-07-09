function createCraneAppBotService({ bcrypt, broadcastToChat, DEVELOPERS, i18n, isDeveloper, logger, query, security, uuidv4 }) {
    async function handleBotCommand(text, userId, botId, chatId, locale) {
        if (!text || !text.startsWith('/')) {
            return null;
        }
        const lang = i18n.normalizeLanguage(locale) || await i18n.languageForUser(userId, query) || 'ru';
        const bt = (key, vars) => i18n.t(lang, key, vars);
    
        const parts = text.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);
    
        let username = '';
        try {
            const user = await query('SELECT username FROM users WHERE id = $1', [userId]);
            username = user.rows[0]?.username || '';
        } catch (e) {
            logger.warn('Bot: failed to get username', e.message);
        }
    
        const isDevUser = isDeveloper(username);
    
        // ── Команды для ВСЕХ пользователей ───────────────────────────────
        if (cmd === '/start' || cmd === '/help') {
            return bt('botHelp') + (isDevUser ? bt('botDevCommands') : '');
        }
    
        if (cmd === '/status') {
            try {
                const u = await query('SELECT username, is_premium, badges FROM users WHERE id = $1', [userId]);
                const r = u.rows[0];
                if (!r) return '❌ ' + bt('userNotFound');
                const badgeList = (r.badges || []).join(', ') || bt('none');
                return `👤 @${r.username}\n💎 Premium: ${r.is_premium ? bt('premiumYes') + ' ✓' : bt('premiumNo')}\n🏷 ${bt('botBadges')}: ${badgeList}`;
            } catch (e) {
                return '❌ ' + bt('botError', { message: e.message });
            }
        }
    
        if (cmd === '/support') {
            const msg = args.join(' ').trim();
            if (!msg) return '❌ ' + bt('botSupportUsage');
            try {
                // Проверяем cooldown 30 минут
                const lastReq = await query(
                    `SELECT created_at FROM support_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
                    [userId]
                );
                if (lastReq.rows.length) {
                    const diff = Date.now() - new Date(lastReq.rows[0].created_at).getTime();
                    const remaining = 30 * 60 * 1000 - diff;
                    if (remaining > 0) {
                        const mins = Math.ceil(remaining / 60000);
                        return '⏳ ' + bt('botSupportCooldown', { minutes: mins });
                    }
                }
                await query(
                    'INSERT INTO support_requests (user_id, chat_id, message) VALUES ($1, $2, $3)',
                    [userId, chatId, msg]
                );
                // Уведомляем разработчиков
                const devs = await query(`SELECT id FROM users WHERE username = ANY($1)`, [Array.from(DEVELOPERS)]);
                for (const dev of devs.rows) {
                    try {
                        const botChat = await query(
                            `SELECT c.id FROM chats c JOIN chat_members cm1 ON c.id=cm1.chat_id AND cm1.user_id=$1 JOIN chat_members cm2 ON c.id=cm2.chat_id AND cm2.user_id=$2 WHERE c.type='private' LIMIT 1`,
                            [dev.id, botId]
                        );
                        if (botChat.rows.length) {
                            const notifId = uuidv4();
                            const devLang = await i18n.languageForUser(dev.id, query) || lang;
                            const notifText = i18n.t(devLang, 'botSupportNotification', { username, message: msg });
                            await query(`INSERT INTO messages (id, chat_id, sender_id, content, type, created_at) VALUES ($1,$2,$3,$4,'text',NOW())`,
                                [notifId, botChat.rows[0].id, botId, notifText]);
                            broadcastToChat(botChat.rows[0].id, { type: 'new_message', chatId: botChat.rows[0].id, message: { id: notifId, senderId: botId, content: notifText, type: 'text', createdAt: new Date() } }, null);
                        }
                    } catch (_) {}
                }
                return '✅ ' + bt('botSupportSent');
            } catch (e) {
                return '❌ ' + bt('botError', { message: e.message });
            }
        }
    
        // ── Команды только для разработчиков ─────────────────────────────
        if (!isDevUser) return null;
    
        if (cmd === '/badge') {
            const target = (args[0] || '').replace('@', '');
            const badge = args[1] || '';
            if (!target) return '❌ ' + bt('botSpecifyUsername');
            const validBadges = ['verified', 'admin', 'developer', 'premium', 'fake', 'scam'];
            if (!validBadges.includes(badge)) return '❌ ' + bt('botAvailableBadges', { badges: validBadges.join(', ') });
            const t = await query('SELECT id, username, badges FROM users WHERE username = $1', [target]);
            if (!t.rows.length) return '❌ ' + bt('botUserNotFoundAt', { username: target });
            const uid = t.rows[0].id;
            if (badge === 'fake') {
                await query('UPDATE users SET is_fake = TRUE, is_scam = FALSE WHERE id = $1', [uid]);
            } else if (badge === 'scam') {
                await query('UPDATE users SET is_scam = TRUE, is_fake = FALSE WHERE id = $1', [uid]);
            } else {
                await query(`UPDATE users SET badges = array_append(COALESCE(badges,'{}'), $1) WHERE id = $2 AND NOT ($1 = ANY(COALESCE(badges,'{}')))`, [badge, uid]);
            }
            return '✅ ' + bt('botBadgeAdded', { username: target, badge });
        }
    
        if (cmd === '/unbadge') {
            const target = (args[0] || '').replace('@', '');
            const badge = args[1] || '';
            if (!target) return '❌ ' + bt('botSpecifyUsername');
            const t = await query('SELECT id, username FROM users WHERE username = $1', [target]);
            if (!t.rows.length) return '❌ ' + bt('botUserNotFoundAt', { username: target });
            if (badge) {
                await query(`UPDATE users SET badges = array_remove(COALESCE(badges,'{}'), $1) WHERE id = $2`, [badge, t.rows[0].id]);
                return '✅ ' + bt('botBadgeRemoved', { username: target, badge });
            } else {
                await query(`UPDATE users SET badges = '{}', is_fake = FALSE, is_scam = FALSE WHERE id = $1`, [t.rows[0].id]);
                return '✅ ' + bt('botBadgesCleared', { username: target });
            }
        }
    
        if (cmd === '/premium') {
            const target = (args[0] || '').replace('@', '');
            if (!target) return '❌ ' + bt('botSpecifyUsername');
            const t = await query('SELECT id, username, is_premium FROM users WHERE username = $1', [target]);
            if (!t.rows.length) return '❌ ' + bt('botUserNotFoundAt', { username: target });
            const newVal = !t.rows[0].is_premium;
            await query('UPDATE users SET is_premium = $1 WHERE id = $2', [newVal, t.rows[0].id]);
            return '✅ ' + bt(newVal ? 'botPremiumGranted' : 'botPremiumRemoved', { username: target });
        }
    
        if (cmd === '/mute') {
            const target = (args[0] || '').replace('@', '');
            const minutes = parseInt(args[1]) || 60;
            if (!target) return '❌ ' + bt('botSpecifyUsername');
            const t = await query('SELECT id, username FROM users WHERE username = $1', [target]);
            if (!t.rows.length) return '❌ ' + bt('botUserNotFoundAt', { username: target });
            const until = new Date(Date.now() + minutes * 60000);
            await query('UPDATE users SET is_muted = TRUE, muted_until = $1 WHERE id = $2', [until, t.rows[0].id]);
            return '🔇 ' + bt('botMuted', { username: target, minutes, time: until.toLocaleTimeString(lang) });
        }
    
        if (cmd === '/unmute') {
            const target = (args[0] || '').replace('@', '');
            if (!target) return '❌ ' + bt('botSpecifyUsername');
            const t = await query('SELECT id, username FROM users WHERE username = $1', [target]);
            if (!t.rows.length) return '❌ ' + bt('botUserNotFoundAt', { username: target });
            await query('UPDATE users SET is_muted = FALSE, muted_until = NULL WHERE id = $1', [t.rows[0].id]);
            return '🔊 ' + bt('botUnmuted', { username: target });
        }
    
        if (cmd === '/ban') {
            const target = (args[0] || '').replace('@', '');
            if (!target) return '❌ ' + bt('botSpecifyUsername');
            const t = await query('SELECT id, username FROM users WHERE username = $1', [target]);
            if (!t.rows.length) return '❌ ' + bt('botUserNotFoundAt', { username: target });
            await query('UPDATE users SET is_banned = TRUE WHERE id = $1', [t.rows[0].id]);
            // Отзываем все сессии
            security.revokeAllUserSessions(t.rows[0].id);
            return '🚫 ' + bt('botBanned', { username: target });
        }
    
        if (cmd === '/unban') {
            const target = (args[0] || '').replace('@', '');
            if (!target) return '❌ ' + bt('botSpecifyUsername');
            const t = await query('SELECT id, username FROM users WHERE username = $1', [target]);
            if (!t.rows.length) return '❌ ' + bt('botUserNotFoundAt', { username: target });
            await query('UPDATE users SET is_banned = FALSE WHERE id = $1', [t.rows[0].id]);
            return '✅ ' + bt('botUnbanned', { username: target });
        }
    
        if (cmd === '/info') {
            const target = (args[0] || '').replace('@', '');
            if (!target) return '❌ ' + bt('botSpecifyUsername');
            const t = await query(
                'SELECT username, first_name, last_name, is_premium, badge, is_fake, is_scam, is_muted, is_banned, created_at, last_seen FROM users WHERE username = $1',
                [target]
            );
            if (!t.rows.length) return '❌ ' + bt('botUserNotFoundAt', { username: target });
            const r = t.rows[0];
            return `👤 @${r.username} (${r.first_name || ''} ${r.last_name || ''})\n`
                + `💎 Premium: ${r.is_premium ? bt('premiumYes') : bt('premiumNo')}\n`
                + `🏷 ${bt('botBadge')}: ${r.badge || bt('none')}\n`
                + `⚠️ ${bt('botFake')}: ${r.is_fake ? bt('premiumYes') : bt('premiumNo')} | Scam: ${r.is_scam ? bt('premiumYes') : bt('premiumNo')}\n`
                + `🔇 ${bt('botMute')}: ${r.is_muted ? bt('premiumYes') : bt('premiumNo')}\n`
                + `🚫 ${bt('botBan')}: ${r.is_banned ? bt('premiumYes') : bt('premiumNo')}\n`
                + `📅 ${bt('botRegistration')}: ${new Date(r.created_at).toLocaleDateString(lang)}\n`
                + `🕐 ${bt('botLastSeen')}: ${r.last_seen ? new Date(r.last_seen).toLocaleString(lang) : bt('lastSeenUnknown')}`;
        }
    
        if (cmd === '/broadcast') {
            const msg = args.join(' ');
            if (!msg) return '❌ ' + bt('botBroadcastUsage');
            const allUsers = await query('SELECT id FROM users WHERE is_bot = FALSE AND is_banned = FALSE');
            let sent = 0;
            for (const u of allUsers.rows) {
                try {
                    // Находим чат с ботом
                    const botChat = await query(
                        `SELECT c.id FROM chats c
                         JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = $1
                         JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = $2
                         WHERE c.type = 'private' LIMIT 1`,
                        [u.id, botId]
                    );
                    if (botChat.rows.length) {
                        const msgId = uuidv4();
                        await query(
                            `INSERT INTO messages (id, chat_id, sender_id, content, type, created_at) VALUES ($1, $2, $3, $4, 'text', NOW())`,
                            [msgId, botChat.rows[0].id, botId, '📢 ' + msg]
                        );
                        broadcastToChat(botChat.rows[0].id, { type: 'new_message', chatId: botChat.rows[0].id, message: { id: msgId, senderId: botId, content: '📢 ' + msg, type: 'text', createdAt: new Date() } }, botId);
                        sent++;
                    }
                } catch (_) {}
            }
            return '✅ ' + bt('botBroadcastSent', { count: sent });
        }
    
        if (cmd === '/stats') {
            const stats = await query(`
                SELECT
                    (SELECT COUNT(*) FROM users WHERE is_bot = FALSE) as users,
                    (SELECT COUNT(*) FROM users WHERE is_premium = TRUE) as premium,
                    (SELECT COUNT(*) FROM users WHERE is_banned = TRUE) as banned,
                    (SELECT COUNT(*) FROM chats) as chats,
                    (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours') as messages_today
            `);
            const r = stats.rows[0];
            return `📊 ${bt('botStatsTitle')}:\n👥 ${bt('botStatsUsers')}: ${r.users}\n💎 Premium: ${r.premium}\n🚫 ${bt('botStatsBanned')}: ${r.banned}\n💬 ${bt('botStatsChats')}: ${r.chats}\n📨 ${bt('botStatsMessagesToday')}: ${r.messages_today}`;
        }
    
        return '❓ ' + bt('botUnknownCommand');
    }
    
    async function createCraneAppBotChat(userId) {
        try {
            // Находим или создаём бота CraneApp
            let botResult = await query("SELECT id FROM users WHERE username = 'craneapp_bot'");
            let botId;
            
            if (botResult.rows.length === 0) {
                const oldBot = await query("SELECT id FROM users WHERE username = 'iris_ai'");
                if (oldBot.rows.length > 0) {
                    botId = oldBot.rows[0].id;
                    const avatarUrl = '/logo.png';
                    await query(`UPDATE users SET username = 'craneapp_bot', first_name = 'CraneApp', avatar_url = $1, badge = 'verified', is_verified = TRUE WHERE id = $2`, [avatarUrl, botId]);
                } else {
                    botId = uuidv4();
                    // Фиксированный пароль для возможности входа в аккаунт бота: логин craneapp_bot, пароль CraneAppBot2026!
                    const botPassword = 'CraneAppBot2026!';
                    const hashedPassword = await bcrypt.hash(botPassword, 10);
                    const avatarUrl = '/logo.png';
                    // Пробуем разные варианты INSERT в зависимости от схемы БД
                    try {
                        await query(
                            `INSERT INTO users (id, username, password_hash, first_name, last_name, phone, is_bot, is_verified, badge, avatar_url, created_at)
                             VALUES ($1, $2, $3, 'CraneApp', '', NULL, TRUE, TRUE, 'verified', $4, NOW())
                             ON CONFLICT (username) DO UPDATE SET first_name = 'CraneApp', is_verified = TRUE, badge = 'verified', avatar_url = $4`,
                            [botId, 'craneapp_bot', hashedPassword, avatarUrl]
                        );
                    } catch (e1) {
                        logger.warn('⚠️ Bot insert v1 failed, trying v2:', e1.message);
                        await query(
                            `INSERT INTO users (id, username, password_hash, first_name, last_name, is_bot, is_verified, badge, avatar_url, created_at)
                             VALUES ($1, $2, $3, 'CraneApp', '', TRUE, TRUE, 'verified', $4, NOW())
                             ON CONFLICT (username) DO UPDATE SET first_name = 'CraneApp', is_verified = TRUE, badge = 'verified', avatar_url = $4`,
                            [botId, 'craneapp_bot', hashedPassword, avatarUrl]
                        );
                    }
                    // Перечитываем ID на случай ON CONFLICT
                    const recheck = await query("SELECT id FROM users WHERE username = 'craneapp_bot'");
                    if (recheck.rows.length > 0) botId = recheck.rows[0].id;
                }
            } else {
                botId = botResult.rows[0].id;
                // Обновляем существующего бота: добавляем аватар и галочку verified
                await query(
                    `UPDATE users SET avatar_url = $1, badge = 'verified', is_verified = TRUE, is_bot = TRUE WHERE id = $2`,
                    ['/logo.png', botId]
                ).catch(() => {});
            }
    
            // Проверяем существующий чат
            const existingChat = await query(
                `SELECT c.id FROM chats c
                 JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = $1
                 JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = $2
                 WHERE c.type = 'private'`,
                [userId, botId]
            );
    
            if (existingChat.rows.length > 0) {
                return existingChat.rows[0].id;
            }
    
            const chatId = uuidv4();
            await query(
                `INSERT INTO chats (id, type, owner_id, created_at)
                 VALUES ($1, 'private', $2, NOW())`,
                [chatId, userId]
            );
            // Обновляем title отдельно — на случай если колонка только что добавлена
            await query(`UPDATE chats SET title = 'CraneApp' WHERE id = $1`, [chatId]).catch(() => {});
    
            await query(
                `INSERT INTO chat_members (chat_id, user_id, role, joined_at)
                 VALUES ($1, $2, 'owner', NOW()), ($1, $3, 'member', NOW())`,
                [chatId, userId, botId]
            );
    
            // Проверяем нет ли уже сообщений в чате
            const existingMsgs = await query('SELECT COUNT(*) FROM messages WHERE chat_id = $1', [chatId]);
            if (parseInt(existingMsgs.rows[0].count) === 0) {
                const lang = await i18n.languageForUser(userId, query) || 'ru';
                await query(
                    `INSERT INTO messages (id, chat_id, sender_id, content, type, created_at)
                     VALUES ($1, $2, $3, $4, 'text', NOW())`,
                    [uuidv4(), chatId, botId, i18n.t(lang, 'botWelcome')]
                );
            }
    
            logger.info('✅ CraneApp chat created for user:', userId);
            return chatId;
        } catch (error) {
            logger.error('❌ Create CraneApp chat error for user ' + userId + ':', error.message);
        }
    }

    return { createCraneAppBotChat, handleBotCommand };
}

module.exports = createCraneAppBotService;

// ============================================
        // REACTIONS
        // ============================================
        const QUICK_REACTIONS = ['👍','❤️','😂','😮','😢','🔥','👏','🎉'];

        let activeGroupMembers = [];
        let selectedGroupMember = null;
        let groupDurationAction = 'mute';

        let reactionPickerEl = null;
        let reactionFullPickerEl = null;
        let reactionTargetMessageId = null;

        function toggleReactionFromMenu(emoji) {
            document.getElementById('messageContextMenu').classList.remove('active');
            if (!isValidUUID(currentMessageId)) return;
            toggleReaction(currentMessageId, emoji);
        }

        function openReactionPickerFromMenu() {
            if (!isValidUUID(currentMessageId)) return;
            const msgId = currentMessageId;
            document.getElementById('messageContextMenu').classList.remove('active');
            setTimeout(() => showFullEmojiPicker(msgId), 50);
        }

        // Подсвечиваем уже поставленные реакции в контекстном меню
        function updateContextMenuReactions(messageId) {
            const msg = messagesData[messageId];
            if (!msg || !msg.reactions) return;
            const myReactions = new Set(msg.reactions.filter(r => r.myReaction).map(r => r.emoji));
            document.querySelectorAll('.context-reaction-btn[onclick*="toggleReactionFromMenu"]').forEach(btn => {
                const emoji = btn.textContent.trim();
                btn.classList.toggle('active-reaction', myReactions.has(emoji));
            });
        }

        function createReactionsElement(messageId, reactions) {
            const el = document.createElement('div');
            el.className = 'message-reactions';
            el.dataset.messageId = messageId;
            reactions.forEach(r => {
                const badge = document.createElement('div');
                badge.className = 'reaction-badge' + (r.myReaction ? ' my-reaction' : '');
                badge.innerHTML = `<span>${r.emoji}</span><span class="reaction-count">${r.count}</span>`;
                badge.onclick = (e) => { e.stopPropagation(); toggleReaction(messageId, r.emoji); };
                el.appendChild(badge);
            });
            return el;
        }

        function updateMessageReactions(messageId, reactions) {
            const msgEl = document.querySelector('[data-message-id="' + messageId + '"]');
            if (!msgEl) return;
            
            const old = msgEl.querySelector('.message-reactions');
            if (old) old.remove();
            
            if (reactions && reactions.length > 0) {
                const reactionsData = reactions.map(r => ({
                    emoji: r.emoji,
                    count: parseInt(r.count),
                    myReaction: r.my_reaction || r.myReaction
                }));
                const el = createReactionsElement(messageId, reactionsData);
                const timeEl = msgEl.querySelector('.msg-time');
                if (timeEl) msgEl.insertBefore(el, timeEl);
                else msgEl.appendChild(el);
            }
        }

        function showReactionPicker(e, messageId) {
            e.stopPropagation();
            closeReactionPicker();
            reactionTargetMessageId = messageId;
            
            reactionPickerEl = document.createElement('div');
            reactionPickerEl.className = 'reaction-picker';
            
            QUICK_REACTIONS.forEach(emoji => {
                const btn = document.createElement('div');
                btn.className = 'reaction-picker-emoji';
                btn.textContent = emoji;
                btn.onclick = (ev) => { ev.stopPropagation(); toggleReaction(messageId, emoji); closeReactionPicker(); };
                reactionPickerEl.appendChild(btn);
            });
            
            const more = document.createElement('div');
            more.className = 'reaction-picker-more';
            more.textContent = '＋';
            more.onclick = (ev) => { ev.stopPropagation(); showFullEmojiPicker(messageId); };
            reactionPickerEl.appendChild(more);
            
            document.body.appendChild(reactionPickerEl);
            
            const msgEl = document.querySelector('[data-message-id="' + messageId + '"]');
            if (msgEl) {
                const rect = msgEl.getBoundingClientRect();
                const pickerW = 320;
                let left = rect.left;
                if (left + pickerW > window.innerWidth) left = window.innerWidth - pickerW - 8;
                if (left < 8) left = 8;
                const top = Math.max(8, rect.top - 60);
                reactionPickerEl.style.left = left + 'px';
                reactionPickerEl.style.top = top + 'px';
            }
        }

        function showFullEmojiPicker(messageId) {
            closeReactionPicker();
            reactionTargetMessageId = messageId;
            
            reactionFullPickerEl = document.createElement('div');
            reactionFullPickerEl.className = 'reaction-full-picker';
            
            const grid = document.createElement('div');
            grid.className = 'reaction-full-picker-grid';
            
            const allCategories = ['smileys', 'animals', 'food', 'activities', 'travel', 'objects', 'symbols'];
            let allEmojis = [];
            allCategories.forEach(cat => {
                if (window.EmojiData && window.EmojiData[cat]) allEmojis = allEmojis.concat(window.EmojiData[cat]);
            });
            if (allEmojis.length === 0) allEmojis = QUICK_REACTIONS;
            
            allEmojis.slice(0, 200).forEach(emoji => {
                const btn = document.createElement('div');
                btn.className = 'reaction-full-picker-emoji';
                btn.textContent = emoji;
                btn.onclick = (e) => { e.stopPropagation(); toggleReaction(messageId, emoji); closeFullEmojiPicker(); };
                grid.appendChild(btn);
            });
            
            reactionFullPickerEl.appendChild(grid);
            document.body.appendChild(reactionFullPickerEl);
            
            // Центрируем по экрану
            const pickerW = 300;
            const pickerH = 280;
            reactionFullPickerEl.style.left = Math.max(8, (window.innerWidth - pickerW) / 2) + 'px';
            reactionFullPickerEl.style.top = Math.max(8, (window.innerHeight - pickerH) / 2) + 'px';
        }

        function closeReactionPicker() {
            if (reactionPickerEl) { reactionPickerEl.remove(); reactionPickerEl = null; }
        }

        function closeFullEmojiPicker() {
            if (reactionFullPickerEl) { reactionFullPickerEl.remove(); reactionFullPickerEl = null; }
        }

        async function toggleReaction(messageId, emoji) {
            if (!isValidUUID(messageId)) return;
            try {
                const res = await fetch('/api/v1/messages/' + messageId + '/reactions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ emoji })
                });
                const data = await res.json();
                if (data.reactions !== undefined) {
                    updateMessageReactions(messageId, data.reactions);
                }
            } catch (err) {
                console.error('Reaction error:', err);
            }
        }

        document.addEventListener('click', function(e) {
            if (reactionPickerEl && !reactionPickerEl.contains(e.target)) closeReactionPicker();
            if (reactionFullPickerEl && !reactionFullPickerEl.contains(e.target)) closeFullEmojiPicker();
        });

        // ============================================
        // INIT
        // ============================================
        const token = localStorage.getItem('craneapp_auth_token');
        let user = {};
        try {
            user = JSON.parse(localStorage.getItem('craneapp_user_data') || '{}') || {};
        } catch (e) {
            console.error('Error parsing craneapp_user_data:', e);
        }
        function formatI18n(value, vars) {
            if (!vars || !value || typeof value !== 'string') return value;
            return value.replace(/\{(\w+)\}/g, function(match, key) {
                return vars[key] !== undefined ? vars[key] : match;
            });
        }
        function tr(key, fallback, vars) {
            const value = window.i18n?.t(key, vars);
            if (value && value !== key) return value;
            return formatI18n(window.i18n?.translations?.en?.[key] || fallback, vars);
        }
        function tc(key, count, fallback) {
            return window.i18n?.tc ? window.i18n.tc(key, count) : (fallback || (count + ' ' + pluralMembers(count)));
        }
        function getAvatarGradient(name) {
            return 'linear-gradient(135deg, #FF007F, #9D00FF)';
        }



        function chatStatusText(userStatus) {
            if (userStatus?.isBot) return tr('bot', 'bot');
            if (!userStatus) return tr('online', 'online');
            if (userStatus.isOnline || userStatus.online) return tr('online', 'online');
            if (userStatus.lastSeen === null) return tr('lastSeenHidden', 'last seen hidden');
            const lastSeen = userStatus.lastSeen ? new Date(userStatus.lastSeen) : null;
            if (lastSeen && !Number.isNaN(lastSeen.getTime())) {
                const diff = Date.now() - lastSeen.getTime();
                const minutes = Math.floor(diff / 60000);
                const hours = Math.floor(diff / 3600000);
                const days = Math.floor(diff / 86400000);
                if (minutes < 1) return tr('justNow', 'just now');
                if (minutes < 60) return tr('minutesAgo', minutes + ' min. ago', { count: minutes });
                if (hours < 24) return tr('hoursAgo', hours + ' h. ago', { count: hours });
                if (days < 7) return tr('daysAgo', days + ' d. ago', { count: days });
            }
            return tr('lastSeenRecently', 'last seen recently');
        }
        const BOT_MESSAGE_TEXTS = {
            ru: {
                botWelcome: '🤖 Здравствуй! Я CraneApp — официальный бот.\n\n✨ Что я умею:\n• Уведомлять о входах с новых устройств\n• Следить за безопасностью твоего аккаунта\n• Сообщать о важных обновлениях\n• Отвечать на твои вопросы 24/7\n\n🛡️ Безопасность превыше всего — если замечу что-то подозрительное, мгновенно сообщу.\n\n💡 Напиши /help в любой момент, чтобы узнать все мои команды.\n\nДобро пожаловать в CraneApp! 🚀',
                botHelp: '🤖 Привет! Я CraneApp — официальный бот.\n\n📋 Команды:\n/help — список команд\n/status — мой статус\n/support text — написать в поддержку',
                botDevCommands: '\n\n🔧 Команды разработчика:\n/badge @user verified|admin|developer|premium|fake|scam — добавить значок\n/unbadge @user [badge] — убрать значок\n/premium @user — выдать/снять Premium\n/mute @user [min] — замутить\n/unmute @user — размутить\n/ban @user — заблокировать\n/unban @user — разблокировать\n/info @user — информация\n/broadcast text — рассылка\n/stats — статистика',
                loginNotification: '🔐 Новый вход в аккаунт\n\n📱 Устройство: {device}\n🌍 Местоположение: {location}\n🌐 IP-адрес: {ip}\n🕐 Время: {time}\n\nЕсли это были не вы — немедленно смените пароль.',
                botSupportUsage: 'Укажите сообщение: /support text',
                botSupportCooldown: 'Вы уже отправляли запрос. Следующий можно отправить через {minutes} мин.',
                botSupportSent: 'Ваш запрос отправлен в поддержку. Мы ответим в ближайшее время.',
                botSupportNotification: '📨 Новый запрос в поддержку от @{username}:\n"{message}"',
                botUnknownCommand: 'Неизвестная команда. Напишите /help',
                botError: 'Ошибка: {message}',
                botStatus: '👤 @{username}\n💎 Premium: {premium}\n🏷 Значки: {badges}',
                botStats: '📊 Статистика CraneApp:\n👥 Пользователей: {users}\n💎 Premium: {premium}\n🚫 Забанено: {banned}\n💬 Чатов: {chats}\n📨 Сообщений за 24ч: {messages}'
            },
            en: {
                botWelcome: '🤖 Hello! I am CraneApp, the official bot.\n\n✨ What I can do:\n• Notify you about logins from new devices\n• Help protect your account\n• Share important updates\n• Answer your questions 24/7\n\n🛡️ Security comes first. If I notice anything suspicious, I will let you know immediately.\n\n💡 Type /help anytime to see all my commands.\n\nWelcome to CraneApp! 🚀',
                botHelp: '🤖 Hi! I am CraneApp, the official bot.\n\n📋 Commands:\n/help — command list\n/status — my status\n/support text — contact support',
                botDevCommands: '\n\n🔧 Developer commands:\n/badge @user verified|admin|developer|premium|fake|scam — add badge\n/unbadge @user [badge] — remove badge\n/premium @user — grant/remove Premium\n/mute @user [min] — mute\n/unmute @user — unmute\n/ban @user — ban\n/unban @user — unban\n/info @user — info\n/broadcast text — broadcast\n/stats — statistics',
                loginNotification: '🔐 New login to your account\n\n📱 Device: {device}\n🌍 Location: {location}\n🌐 IP address: {ip}\n🕐 Time: {time}\n\nIf this was not you, change your password immediately.',
                botSupportUsage: 'Specify a message: /support text',
                botSupportCooldown: 'You have already sent a request. You can send the next one in {minutes} min.',
                botSupportSent: 'Your request was sent to support. We will reply soon.',
                botSupportNotification: '📨 New support request from @{username}:\n"{message}"',
                botUnknownCommand: 'Unknown command. Type /help',
                botError: 'Error: {message}',
                botStatus: '👤 @{username}\n💎 Premium: {premium}\n🏷 Badges: {badges}',
                botStats: '📊 CraneApp statistics:\n👥 Users: {users}\n💎 Premium: {premium}\n🚫 Banned: {banned}\n💬 Chats: {chats}\n📨 Messages in 24h: {messages}'
            },
            de: {
                botWelcome: '🤖 Hallo! Ich bin CraneApp, der offizielle Bot.\n\n✨ Was ich kann:\n• Dich über Anmeldungen von neuen Geräten informieren\n• Dein Konto schützen helfen\n• Wichtige Updates teilen\n• Deine Fragen rund um die Uhr beantworten\n\n🛡️ Sicherheit geht vor. Wenn ich etwas Verdächtiges bemerke, sage ich dir sofort Bescheid.\n\n💡 Tippe jederzeit /help, um alle Befehle zu sehen.\n\nWillkommen bei CraneApp! 🚀',
                botHelp: '🤖 Hi! Ich bin CraneApp, der offizielle Bot.\n\n📋 Befehle:\n/help — Befehlsliste\n/status — mein Status\n/support text — Support kontaktieren',
                botDevCommands: '\n\n🔧 Entwicklerbefehle:\n/badge @user verified|admin|developer|premium|fake|scam — Badge hinzufügen\n/unbadge @user [badge] — Badge entfernen\n/premium @user — Premium vergeben/entfernen\n/mute @user [min] — stummschalten\n/unmute @user — Stummschaltung aufheben\n/ban @user — sperren\n/unban @user — entsperren\n/info @user — Info\n/broadcast text — Broadcast\n/stats — Statistik',
                loginNotification: '🔐 Neue Anmeldung bei deinem Konto\n\n📱 Gerät: {device}\n🌍 Standort: {location}\n🌐 IP-Adresse: {ip}\n🕐 Zeit: {time}\n\nWenn du das nicht warst, ändere sofort dein Passwort.',
                botSupportUsage: 'Gib eine Nachricht an: /support text',
                botSupportCooldown: 'Du hast bereits eine Anfrage gesendet. Die nächste ist in {minutes} Min. möglich.',
                botSupportSent: 'Deine Anfrage wurde an den Support gesendet. Wir antworten bald.',
                botSupportNotification: '📨 Neue Support-Anfrage von @{username}:\n"{message}"',
                botUnknownCommand: 'Unbekannter Befehl. Tippe /help',
                botError: 'Fehler: {message}',
                botStatus: '👤 @{username}\n💎 Premium: {premium}\n🏷 Badges: {badges}',
                botStats: '📊 CraneApp-Statistik:\n👥 Nutzer: {users}\n💎 Premium: {premium}\n🚫 Gesperrt: {banned}\n💬 Chats: {chats}\n📨 Nachrichten in 24h: {messages}'
            },
            fr: {
                botWelcome: '🤖 Bonjour ! Je suis CraneApp, le bot officiel.\n\n✨ Ce que je peux faire :\n• Vous avertir des connexions depuis de nouveaux appareils\n• Aider à protéger votre compte\n• Partager les mises à jour importantes\n• Répondre à vos questions 24/7\n\n🛡️ La sécurité passe avant tout. Si je remarque quelque chose de suspect, je vous préviens immédiatement.\n\n💡 Tapez /help à tout moment pour voir toutes mes commandes.\n\nBienvenue sur CraneApp ! 🚀',
                botHelp: '🤖 Salut ! Je suis CraneApp, le bot officiel.\n\n📋 Commandes :\n/help — liste des commandes\n/status — mon statut\n/support text — contacter le support',
                botDevCommands: '\n\n🔧 Commandes développeur :\n/badge @user verified|admin|developer|premium|fake|scam — ajouter un badge\n/unbadge @user [badge] — retirer un badge\n/premium @user — accorder/retirer Premium\n/mute @user [min] — rendre muet\n/unmute @user — réactiver\n/ban @user — bannir\n/unban @user — débannir\n/info @user — info\n/broadcast text — diffusion\n/stats — statistiques',
                loginNotification: '🔐 Nouvelle connexion à votre compte\n\n📱 Appareil : {device}\n🌍 Emplacement : {location}\n🌐 Adresse IP : {ip}\n🕐 Heure : {time}\n\nSi ce n’était pas vous, changez immédiatement votre mot de passe.',
                botSupportUsage: 'Indiquez un message : /support text',
                botSupportCooldown: 'Vous avez déjà envoyé une demande. La prochaine sera possible dans {minutes} min.',
                botSupportSent: 'Votre demande a été envoyée au support. Nous répondrons bientôt.',
                botSupportNotification: '📨 Nouvelle demande de support de @{username} :\n"{message}"',
                botUnknownCommand: 'Commande inconnue. Tapez /help',
                botError: 'Erreur : {message}',
                botStatus: '👤 @{username}\n💎 Premium : {premium}\n🏷 Badges : {badges}',
                botStats: '📊 Statistiques CraneApp :\n👥 Utilisateurs : {users}\n💎 Premium : {premium}\n🚫 Bannis : {banned}\n💬 Chats : {chats}\n📨 Messages en 24h : {messages}'
            },
            es: {
                botWelcome: '🤖 ¡Hola! Soy CraneApp, el bot oficial.\n\n✨ Lo que puedo hacer:\n• Avisarte sobre inicios de sesión desde nuevos dispositivos\n• Ayudar a proteger tu cuenta\n• Compartir actualizaciones importantes\n• Responder tus preguntas 24/7\n\n🛡️ La seguridad es lo primero. Si noto algo sospechoso, te avisaré de inmediato.\n\n💡 Escribe /help cuando quieras para ver todos mis comandos.\n\n¡Bienvenido a CraneApp! 🚀',
                botHelp: '🤖 ¡Hola! Soy CraneApp, el bot oficial.\n\n📋 Comandos:\n/help — lista de comandos\n/status — mi estado\n/support text — contactar soporte',
                botDevCommands: '\n\n🔧 Comandos de desarrollador:\n/badge @user verified|admin|developer|premium|fake|scam — añadir insignia\n/unbadge @user [badge] — quitar insignia\n/premium @user — dar/quitar Premium\n/mute @user [min] — silenciar\n/unmute @user — quitar silencio\n/ban @user — bloquear\n/unban @user — desbloquear\n/info @user — información\n/broadcast text — difusión\n/stats — estadísticas',
                loginNotification: '🔐 Nuevo inicio de sesión en tu cuenta\n\n📱 Dispositivo: {device}\n🌍 Ubicación: {location}\n🌐 Dirección IP: {ip}\n🕐 Hora: {time}\n\nSi no fuiste tú, cambia tu contraseña inmediatamente.',
                botSupportUsage: 'Indica un mensaje: /support text',
                botSupportCooldown: 'Ya enviaste una solicitud. Podrás enviar la siguiente en {minutes} min.',
                botSupportSent: 'Tu solicitud fue enviada a soporte. Responderemos pronto.',
                botSupportNotification: '📨 Nueva solicitud de soporte de @{username}:\n"{message}"',
                botUnknownCommand: 'Comando desconocido. Escribe /help',
                botError: 'Error: {message}',
                botStatus: '👤 @{username}\n💎 Premium: {premium}\n🏷 Insignias: {badges}',
                botStats: '📊 Estadísticas de CraneApp:\n👥 Usuarios: {users}\n💎 Premium: {premium}\n🚫 Bloqueados: {banned}\n💬 Chats: {chats}\n📨 Mensajes en 24h: {messages}'
            },
            it: {
                botWelcome: '🤖 Ciao! Sono CraneApp, il bot ufficiale.\n\n✨ Cosa posso fare:\n• Avvisarti degli accessi da nuovi dispositivi\n• Aiutare a proteggere il tuo account\n• Condividere aggiornamenti importanti\n• Rispondere alle tue domande 24/7\n\n🛡️ La sicurezza viene prima di tutto. Se noto qualcosa di sospetto, te lo dirò subito.\n\n💡 Scrivi /help in qualsiasi momento per vedere tutti i comandi.\n\nBenvenuto in CraneApp! 🚀',
                botHelp: '🤖 Ciao! Sono CraneApp, il bot ufficiale.\n\n📋 Comandi:\n/help — elenco comandi\n/status — il mio stato\n/support text — contatta il supporto',
                botDevCommands: '\n\n🔧 Comandi sviluppatore:\n/badge @user verified|admin|developer|premium|fake|scam — aggiungi badge\n/unbadge @user [badge] — rimuovi badge\n/premium @user — assegna/rimuovi Premium\n/mute @user [min] — silenzia\n/unmute @user — rimuovi silenzio\n/ban @user — blocca\n/unban @user — sblocca\n/info @user — info\n/broadcast text — broadcast\n/stats — statistiche',
                loginNotification: '🔐 Nuovo accesso al tuo account\n\n📱 Dispositivo: {device}\n🌍 Posizione: {location}\n🌐 Indirizzo IP: {ip}\n🕐 Ora: {time}\n\nSe non eri tu, cambia subito la password.',
                botSupportUsage: 'Specifica un messaggio: /support text',
                botSupportCooldown: 'Hai già inviato una richiesta. Potrai inviarne un’altra tra {minutes} min.',
                botSupportSent: 'La tua richiesta è stata inviata al supporto. Risponderemo presto.',
                botSupportNotification: '📨 Nuova richiesta di supporto da @{username}:\n"{message}"',
                botUnknownCommand: 'Comando sconosciuto. Scrivi /help',
                botError: 'Errore: {message}',
                botStatus: '👤 @{username}\n💎 Premium: {premium}\n🏷 Badge: {badges}',
                botStats: '📊 Statistiche CraneApp:\n👥 Utenti: {users}\n💎 Premium: {premium}\n🚫 Bloccati: {banned}\n💬 Chat: {chats}\n📨 Messaggi in 24h: {messages}'
            },
            pt: {
                botWelcome: '🤖 Olá! Eu sou o CraneApp, o bot oficial.\n\n✨ O que posso fazer:\n• Avisar sobre logins em novos dispositivos\n• Ajudar a proteger sua conta\n• Compartilhar atualizações importantes\n• Responder suas perguntas 24/7\n\n🛡️ Segurança em primeiro lugar. Se eu notar algo suspeito, avisarei imediatamente.\n\n💡 Digite /help a qualquer momento para ver todos os comandos.\n\nBem-vindo ao CraneApp! 🚀',
                botHelp: '🤖 Oi! Eu sou o CraneApp, o bot oficial.\n\n📋 Comandos:\n/help — lista de comandos\n/status — meu status\n/support text — contatar suporte',
                botDevCommands: '\n\n🔧 Comandos de desenvolvedor:\n/badge @user verified|admin|developer|premium|fake|scam — adicionar selo\n/unbadge @user [badge] — remover selo\n/premium @user — conceder/remover Premium\n/mute @user [min] — silenciar\n/unmute @user — remover silêncio\n/ban @user — banir\n/unban @user — desbanir\n/info @user — informação\n/broadcast text — transmissão\n/stats — estatísticas',
                loginNotification: '🔐 Novo login na sua conta\n\n📱 Dispositivo: {device}\n🌍 Localização: {location}\n🌐 Endereço IP: {ip}\n🕐 Hora: {time}\n\nSe não foi você, altere sua senha imediatamente.',
                botSupportUsage: 'Informe uma mensagem: /support text',
                botSupportCooldown: 'Você já enviou uma solicitação. A próxima poderá ser enviada em {minutes} min.',
                botSupportSent: 'Sua solicitação foi enviada ao suporte. Responderemos em breve.',
                botSupportNotification: '📨 Nova solicitação de suporte de @{username}:\n"{message}"',
                botUnknownCommand: 'Comando desconhecido. Digite /help',
                botError: 'Erro: {message}',
                botStatus: '👤 @{username}\n💎 Premium: {premium}\n🏷 Selos: {badges}',
                botStats: '📊 Estatísticas do CraneApp:\n👥 Usuários: {users}\n💎 Premium: {premium}\n🚫 Banidos: {banned}\n💬 Chats: {chats}\n📨 Mensagens em 24h: {messages}'
            },
            pl: {
                botWelcome: '🤖 Cześć! Jestem CraneApp, oficjalny bot.\n\n✨ Co potrafię:\n• Powiadamiać o logowaniach z nowych urządzeń\n• Pomagać chronić konto\n• Przekazywać ważne aktualizacje\n• Odpowiadać na pytania 24/7\n\n🛡️ Bezpieczeństwo jest najważniejsze. Jeśli zauważę coś podejrzanego, od razu dam znać.\n\n💡 Wpisz /help w dowolnym momencie, aby zobaczyć wszystkie komendy.\n\nWitamy w CraneApp! 🚀',
                botHelp: '🤖 Cześć! Jestem CraneApp, oficjalny bot.\n\n📋 Komendy:\n/help — lista komend\n/status — mój status\n/support text — kontakt z pomocą',
                botDevCommands: '\n\n🔧 Komendy deweloperskie:\n/badge @user verified|admin|developer|premium|fake|scam — dodaj odznakę\n/unbadge @user [badge] — usuń odznakę\n/premium @user — nadaj/usuń Premium\n/mute @user [min] — wycisz\n/unmute @user — cofnij wyciszenie\n/ban @user — zablokuj\n/unban @user — odblokuj\n/info @user — info\n/broadcast text — ogłoszenie\n/stats — statystyki',
                loginNotification: '🔐 Nowe logowanie na konto\n\n📱 Urządzenie: {device}\n🌍 Lokalizacja: {location}\n🌐 Adres IP: {ip}\n🕐 Czas: {time}\n\nJeśli to nie Ty, natychmiast zmień hasło.',
                botSupportUsage: 'Podaj wiadomość: /support text',
                botSupportCooldown: 'Wysłano już zgłoszenie. Następne będzie możliwe za {minutes} min.',
                botSupportSent: 'Twoje zgłoszenie wysłano do pomocy. Odpowiemy wkrótce.',
                botSupportNotification: '📨 Nowe zgłoszenie do pomocy od @{username}:\n"{message}"',
                botUnknownCommand: 'Nieznana komenda. Wpisz /help',
                botError: 'Błąd: {message}',
                botStatus: '👤 @{username}\n💎 Premium: {premium}\n🏷 Odznaki: {badges}',
                botStats: '📊 Statystyki CraneApp:\n👥 Użytkownicy: {users}\n💎 Premium: {premium}\n🚫 Zablokowani: {banned}\n💬 Czaty: {chats}\n📨 Wiadomości w 24h: {messages}'
            },
            uk: {
                botWelcome: '🤖 Вітаю! Я CraneApp, офіційний бот.\n\n✨ Що я вмію:\n• Повідомляти про входи з нових пристроїв\n• Допомагати захищати акаунт\n• Ділитися важливими оновленнями\n• Відповідати на запитання 24/7\n\n🛡️ Безпека понад усе. Якщо помічу щось підозріле, одразу повідомлю.\n\n💡 Напишіть /help будь-коли, щоб побачити всі мої команди.\n\nЛаскаво просимо до CraneApp! 🚀',
                botHelp: '🤖 Привіт! Я CraneApp, офіційний бот.\n\n📋 Команди:\n/help — список команд\n/status — мій статус\n/support text — звернутися в підтримку',
                botDevCommands: '\n\n🔧 Команди розробника:\n/badge @user verified|admin|developer|premium|fake|scam — додати значок\n/unbadge @user [badge] — прибрати значок\n/premium @user — видати/зняти Premium\n/mute @user [min] — замутити\n/unmute @user — розмутити\n/ban @user — заблокувати\n/unban @user — розблокувати\n/info @user — інформація\n/broadcast text — розсилка\n/stats — статистика',
                loginNotification: '🔐 Новий вхід в акаунт\n\n📱 Пристрій: {device}\n🌍 Місцезнаходження: {location}\n🌐 IP-адреса: {ip}\n🕐 Час: {time}\n\nЯкщо це були не ви, негайно змініть пароль.',
                botSupportUsage: 'Вкажіть повідомлення: /support text',
                botSupportCooldown: 'Ви вже надсилали запит. Наступний можна надіслати через {minutes} хв.',
                botSupportSent: 'Ваш запит надіслано в підтримку. Ми відповімо найближчим часом.',
                botSupportNotification: '📨 Новий запит у підтримку від @{username}:\n"{message}"',
                botUnknownCommand: 'Невідома команда. Напишіть /help',
                botError: 'Помилка: {message}',
                botStatus: '👤 @{username}\n💎 Premium: {premium}\n🏷 Значки: {badges}',
                botStats: '📊 Статистика CraneApp:\n👥 Користувачів: {users}\n💎 Premium: {premium}\n🚫 Заблоковано: {banned}\n💬 Чатів: {chats}\n📨 Повідомлень за 24г: {messages}'
            },
            tr: {
                botWelcome: '🤖 Merhaba! Ben CraneApp, resmi bot.\n\n✨ Yapabildiklerim:\n• Yeni cihazlardan girişleri bildirmek\n• Hesabını korumaya yardımcı olmak\n• Önemli güncellemeleri paylaşmak\n• Sorularını 7/24 yanıtlamak\n\n🛡️ Güvenlik önce gelir. Şüpheli bir şey fark edersem hemen haber veririm.\n\n💡 Tüm komutları görmek için istediğin zaman /help yaz.\n\nCraneApp’e hoş geldin! 🚀',
                botHelp: '🤖 Selam! Ben CraneApp, resmi bot.\n\n📋 Komutlar:\n/help — komut listesi\n/status — durumum\n/support text — desteğe yaz',
                botDevCommands: '\n\n🔧 Geliştirici komutları:\n/badge @user verified|admin|developer|premium|fake|scam — rozet ekle\n/unbadge @user [badge] — rozeti kaldır\n/premium @user — Premium ver/kaldır\n/mute @user [min] — sustur\n/unmute @user — susturmayı kaldır\n/ban @user — engelle\n/unban @user — engeli kaldır\n/info @user — bilgi\n/broadcast text — duyuru\n/stats — istatistik',
                loginNotification: '🔐 Hesabına yeni giriş\n\n📱 Cihaz: {device}\n🌍 Konum: {location}\n🌐 IP adresi: {ip}\n🕐 Zaman: {time}\n\nBu sen değilsen hemen şifreni değiştir.',
                botSupportUsage: 'Bir mesaj belirt: /support text',
                botSupportCooldown: 'Zaten bir istek gönderdin. Sonrakini {minutes} dk. içinde gönderebilirsin.',
                botSupportSent: 'İsteğin desteğe gönderildi. Yakında yanıtlayacağız.',
                botSupportNotification: '📨 @{username} kullanıcısından yeni destek isteği:\n"{message}"',
                botUnknownCommand: 'Bilinmeyen komut. /help yaz',
                botError: 'Hata: {message}',
                botStatus: '👤 @{username}\n💎 Premium: {premium}\n🏷 Rozetler: {badges}',
                botStats: '📊 CraneApp istatistikleri:\n👥 Kullanıcılar: {users}\n💎 Premium: {premium}\n🚫 Engellenenler: {banned}\n💬 Sohbetler: {chats}\n📨 24 saatte mesaj: {messages}'
            }
        };
        const BOT_SOURCE_ALIASES = {
            botHelp: ['🤖 Привет! Я CraneApp — официальный бот.\n\n📋 Команды:\n/help — список команд\n/status — мой статус\n/support текст — написать в поддержку'],
            botDevCommands: ['\n\n🔧 Команды разработчика:\n/badge @user verified|admin|developer|premium|fake|scam — добавить значок\n/unbadge @user [значок] — убрать значок\n/premium @user — выдать/снять Premium\n/mute @user [мин] — замутить\n/unmute @user — размутить\n/ban @user — заблокировать\n/unban @user — разблокировать\n/info @user — информация\n/broadcast текст — рассылка\n/stats — статистика'],
            botSupportUsage: ['Укажите сообщение: /support ваш вопрос', 'Specify a message: /support your question']
        };
        const BOT_TEMPLATE_KEYS = ['loginNotification', 'botSupportCooldown', 'botSupportNotification', 'botError', 'botStatus', 'botStats'];
        const botTemplateCache = {};
        function currentBotLang() {
            return BOT_MESSAGE_TEXTS[window.i18n?.currentLang] ? window.i18n.currentLang : 'en';
        }
        function botText(key, vars) {
            const lang = currentBotLang();
            return formatI18n((BOT_MESSAGE_TEXTS[lang] && BOT_MESSAGE_TEXTS[lang][key]) || BOT_MESSAGE_TEXTS.en[key] || BOT_MESSAGE_TEXTS.ru[key] || key, vars);
        }
        function isCraneAppBotMessage(m) {
            const senderUsername = m?.senderUsername || m?.sender?.username || '';
            if (senderUsername === 'craneapp_bot') return true;
            const chatUser = activeChat && chatUsers[activeChat.id];
            const senderId = m?.sender_id || m?.senderId || m?.sender?.id;
            if (chatUser && chatUser.isBot && senderId && String(senderId) === String(chatUser.id)) return true;
            return !!((m?.isBot === true || m?.senderIsBot === true || m?.sender?.isBot === true)
                && activeChat && activeChat.name === 'CraneApp');
        }
        function escapeRegExp(value) {
            return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        function templateToMatcher(template) {
            const names = [];
            let pattern = escapeRegExp(template).replace(/\\\{(\w+)\\\}/g, function(_, name) {
                names.push(name);
                return '([\\s\\S]*?)';
            });
            return { regex: new RegExp('^' + pattern + '$'), names };
        }
        function botSourceValues(key) {
            const values = [];
            Object.keys(BOT_MESSAGE_TEXTS).forEach(function(lang) {
                if (BOT_MESSAGE_TEXTS[lang][key]) values.push(BOT_MESSAGE_TEXTS[lang][key]);
            });
            (BOT_SOURCE_ALIASES[key] || []).forEach(function(value) { values.push(value); });
            return values;
        }
        function matchBotTemplate(key, text) {
            botTemplateCache[key] = botTemplateCache[key] || botSourceValues(key).map(templateToMatcher);
            for (const matcher of botTemplateCache[key]) {
                const match = String(text).match(matcher.regex);
                if (!match) continue;
                const vars = {};
                matcher.names.forEach(function(name, index) {
                    vars[name] = match[index + 1];
                });
                return vars;
            }
            return null;
        }
        function normalizeBotMessageCommands(text) {
            return String(text || '')
                .replace('/support текст', '/support text')
                .replace('/support ваш вопрос', '/support text')
                .replace('/support your question', '/support text')
                .replace('/broadcast текст', '/broadcast text')
                .replace('/unbadge @user [значок]', '/unbadge @user [badge]')
                .replace('/mute @user [мин]', '/mute @user [min]');
        }
        function localizeBotMessageText(text) {
            if (!text || typeof text !== 'string') return text || '';
            const normalized = normalizeBotMessageCommands(text);
            const helpDevSources = botSourceValues('botHelp').flatMap(function(help) {
                return botSourceValues('botDevCommands').map(function(dev) {
                    return normalizeBotMessageCommands(help + dev);
                });
            });
            if (helpDevSources.includes(normalized)) return botText('botHelp') + botText('botDevCommands');
            const statusPrefix = normalized.match(/^([✅❌⏳]\s+)([\s\S]+)$/);
            if (statusPrefix) {
                const localizedBody = localizeBotMessageText(statusPrefix[2]);
                if (localizedBody !== statusPrefix[2]) return statusPrefix[1] + localizedBody;
            }
            for (const key of Object.keys(BOT_MESSAGE_TEXTS.en)) {
                if (BOT_TEMPLATE_KEYS.includes(key)) continue;
                if (botSourceValues(key).map(normalizeBotMessageCommands).includes(normalized)) {
                    return botText(key);
                }
            }
            for (const key of BOT_TEMPLATE_KEYS) {
                const vars = matchBotTemplate(key, normalized);
                if (vars) return botText(key, vars);
            }
            return text;
        }

        // Инициализируем E2E шифрование
        if (token && window.E2E) {
            window.e2eInitPromise = window.E2E.init(token).then(ok => {
                if (ok) console.log('🔐 E2E encryption ready');
                return ok;
            });
        }

        // Прогрев маршрута опросов (первый POST на мобильном часто ждёт preflight)
        if (token) {
            fetch('/api/v1/polls/batch?ids=', {
                headers: { 'Authorization': 'Bearer ' + token }
            }).catch(function() {});
        }
        
        if (!token) {
            window.location.href = '../auth/login.html';
        }

        let activeChat = null;
        let activeTopic = null;
        let groupMembersForMentions = [];
        let globalMuted = false;
        let globalMutedUntil = null;
        let muteCountdownInterval = null;
        let currentUserGroupOnline = false;
        let mentionSuggestionsList = [];
        let mentionSuggestionIndex = 0;
        const mentionHelpers = window.mentionNotifications;
        const mentionJumpCursorByChat = {};
        let allChats = [];
        let chatUsers = {};
        let searchTimeout = null;
        let currentMessageId = null;
        let currentMessageElement = null;
        let replyingTo = null;
        let messagesData = {};
        let commentThreadPostId = null;
        let inputAreaOriginalParent = null;
        let inputAreaOriginalNextSibling = null;
        let currentPreviewMediaUrl = null;

        function captureMainInputAreaHome() {
            const inputArea = document.getElementById('mainInputArea');
            if (!inputArea || !inputArea.parentNode) return;
            if (inputAreaOriginalParent && inputArea.parentNode === inputAreaOriginalParent) return;
            if (!inputAreaOriginalParent || inputArea.parentNode.id !== 'channelCommentsInputMount') {
                inputAreaOriginalParent = inputArea.parentNode;
                inputAreaOriginalNextSibling = inputArea.nextSibling;
            }
        }

        function restoreMainInputArea() {
            const inputArea = document.getElementById('mainInputArea');
            if (!inputArea) return;
            captureMainInputAreaHome();
            if (!inputAreaOriginalParent || inputArea.parentNode === inputAreaOriginalParent) return;
            if (inputAreaOriginalNextSibling && inputAreaOriginalNextSibling.parentNode === inputAreaOriginalParent) {
                inputAreaOriginalParent.insertBefore(inputArea, inputAreaOriginalNextSibling);
            } else {
                inputAreaOriginalParent.appendChild(inputArea);
            }
            const mount = document.getElementById('channelCommentsInputMount');
            if (mount) mount.innerHTML = '';
        }

        window.restoreChannelFeedUi = function() {
            commentThreadPostId = null;
            restoreMainInputArea();
            const chatView = document.getElementById('chatView');
            if (chatView) chatView.classList.remove('channel-comments-mode');
            const commentsView = document.getElementById('channelCommentsView');
            if (commentsView) commentsView.setAttribute('aria-hidden', 'true');
            const messagesArea = document.getElementById('messagesArea');
            if (messagesArea) messagesArea.style.display = 'flex';
            document.querySelectorAll('.channel-post-comments-btn.active').forEach(function(btn) {
                btn.classList.remove('active');
            });
        };

        if (document.getElementById('mainInputArea')) {
            captureMainInputAreaHome();
        }

        function isCommentThreadActive() {
            if (!commentThreadPostId) return false;
            const chatView = document.getElementById('chatView');
            return !!(chatView && chatView.classList.contains('channel-comments-mode'));
        }

        function isChannelPostMessage(m) {
            if (!activeChat || activeChat.type !== 'channel') return false;
            const inCommentThread = isCommentThreadActive()
                || !!(m && (m.parentMessageId || m.parent_message_id));
            return !inCommentThread;
        }

        function getActiveMessagesEl() {
            return isCommentThreadActive()
                ? document.getElementById('channelCommentsMessages')
                : document.getElementById('messages');
        }

        function getActiveMessagesContainer() {
            return isCommentThreadActive()
                ? document.querySelector('#channelCommentsView .messages-container')
                : document.getElementById('messagesContainer');
        }

        function appendMessageToActiveList(msg) {
            const listEl = getActiveMessagesEl();
            if (!listEl) return;
            const emptyState = listEl.querySelector('.channel-comments-state');
            if (emptyState) emptyState.remove();
            listEl.appendChild(createMessageElement(msg));
            scrollToBottom();
        }

        function bumpPostCommentCount(postId, comment) {
            if (!postId) return;
            if (messagesData[postId]) {
                messagesData[postId].commentCount = (messagesData[postId].commentCount || 0) + 1;
            }
            if (comment && typeof window.appendPostCommentPreview === 'function') {
                window.appendPostCommentPreview(postId, comment);
            } else if (typeof window.updatePostCommentCount === 'function') {
                window.updatePostCommentCount(postId, messagesData[postId]?.commentCount || 0);
            }
        }

        function buildCommentPreviewFromMessages(messages) {
            const preview = [];
            const seen = new Set();
            for (let i = messages.length - 1; i >= 0 && preview.length < 3; i--) {
                const msg = messages[i];
                if (!msg || !msg.senderId || seen.has(msg.senderId)) continue;
                seen.add(msg.senderId);
                preview.push({
                    senderId: msg.senderId,
                    senderFirstName: msg.senderFirstName,
                    senderUsername: msg.senderUsername,
                    senderAvatar: msg.senderAvatar
                });
            }
            return preview;
        }

        window.isCommentThreadActive = isCommentThreadActive;
        window.getCommentThreadPostId = function() { return commentThreadPostId; };

        window.enterCommentThreadMode = function(postId) {
            commentThreadPostId = postId;
            captureMainInputAreaHome();
            const inputArea = document.getElementById('mainInputArea');
            const mount = document.getElementById('channelCommentsInputMount');
            if (inputArea && mount) {
                mount.appendChild(inputArea);
                inputArea.style.display = 'flex';
            }
            const tools = document.getElementById('channelAdminTools');
            if (tools) tools.style.display = 'none';
            const bar = document.getElementById('channelSubscriberBar');
            if (bar) bar.style.display = 'none';
            const pollBtn = document.getElementById('pollAttachBtn');
            if (pollBtn) pollBtn.style.display = 'none';
            const msgInput = document.getElementById('msgInput');
            if (msgInput) {
                msgInput.setAttribute('data-placeholder', tr('writeComment', 'Написать комментарий...'));
            }
            cancelReply();
        };

        window.exitCommentThreadMode = function() {
            window.restoreChannelFeedUi();
            const msgInput = document.getElementById('msgInput');
            if (msgInput) {
                msgInput.innerText = '';
                msgInput.removeAttribute('data-placeholder');
            }
            updateSendButton();
        };

        window.loadCommentThread = async function(postId) {
            const list = document.getElementById('channelCommentsMessages');
            if (!list || !activeChat) return;
            list.innerHTML = '<div class="channel-comments-state">' + tr('loading', 'Загрузка...') + '</div>';
            try {
                const res = await fetch('/api/v1/messages/' + activeChat.id + '?parentMessageId=' + encodeURIComponent(postId), {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                const messages = data.messages || [];
                const preview = buildCommentPreviewFromMessages(messages);
                if (messagesData[postId]) {
                    messagesData[postId].commentCount = messages.length;
                    messagesData[postId].commentPreview = preview;
                }
                if (typeof window.updatePostCommentCount === 'function') {
                    window.updatePostCommentCount(postId, messages.length, preview);
                }
                list.innerHTML = '';
                if (!messages.length) {
                    list.innerHTML = '<div class="channel-comments-state">' + tr('noComments', 'Комментариев пока нет') + '</div>';
                    return;
                }
                messages.forEach(function(m) {
                    messagesData[m.id] = m;
                    if (m.type === 'poll' && m.poll) rememberPollPayload(m.id, m.poll);
                });
                const frag = document.createDocumentFragment();
                messages.forEach(function(m) {
                    frag.appendChild(createMessageElement(m));
                });
                list.appendChild(frag);
                scrollToBottom(false);
            } catch (e) {
                list.innerHTML = '<div class="channel-comments-state channel-comments-state-error">' + tr('loadError', 'Ошибка загрузки') + '</div>';
            }
        };
        
        let currentEmojiCategory = 'smileys';

        // ── Проверка наличия камеры ────────────────────────────────────────
        let cameraAvailable = false;

        (async function checkCamera() {
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
                const devices = await navigator.mediaDevices.enumerateDevices();
                cameraAvailable = devices.some(d => d.kind === 'videoinput');
            } catch (_) {
                cameraAvailable = false;
            }
        })();
        
        let stickerPacks = [];
        let currentStickerPackId = null;
        let newPackIconData = null;
        
        let savedGifs = [];
        
        let ws = null;
        let wsReconnectTimer = null;

        // ============================================
        // PIN & ARCHIVE CHATS
        // ============================================
        
        let currentContextChatId = null;
        let archivedChats = [];
        let pinnedChatIds = new Set();

        // ============================================
        // SIDE MENU
        // ============================================
        function openSideMenu() {
            document.getElementById('sideMenuOverlay').classList.add('active');
            document.getElementById('sideMenu').classList.add('active');
        }

        function closeSideMenu() {
            document.getElementById('sideMenuOverlay').classList.remove('active');
            document.getElementById('sideMenu').classList.remove('active');
        }

        // ============================================
        // SETTINGS / ABOUT HUBS
        // ============================================
        function openSettingsHub() {
            closeSideMenu();
            const hub = document.getElementById('settingsHub');
            if (hub) hub.classList.add('active');
        }
        function closeSettingsHub() {
            const hub = document.getElementById('settingsHub');
            if (hub) hub.classList.remove('active');
        }
        function openAboutHub() {
            closeSideMenu();
            const hub = document.getElementById('aboutHub');
            if (hub) hub.classList.add('active');
        }
        function closeAboutHub() {
            const hub = document.getElementById('aboutHub');
            if (hub) hub.classList.remove('active');
        }

        // ESC закрывает хабы (на десктопе)
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeSettingsHub();
                closeAboutHub();
            }
        });

        // ============================================
        // VIDEO CALLS (старт + входящие)
        // ============================================
        let _incomingCall = null;

        // Координация звонков между вкладками одного браузера
        const _callTabChannel = (typeof BroadcastChannel !== 'undefined')
            ? new BroadcastChannel('crane_calls') : null;
        if (_callTabChannel) {
            _callTabChannel.onmessage = (e) => {
                if (!e.data) return;
                if (e.data.type === 'call_tab_handled' && _incomingCall && _incomingCall.roomId === e.data.roomId) {
                    try { _stopRingtone(); } catch(_) {}
                    _hideIncomingCallBanner();
                    _incomingCall = null;
                }
            };
        }

        function _genRoomId() { return 'rm_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

        function _groupCallRoomId(chatId) {
            if (!chatId) return null;
            return 'grp_' + String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_');
        }

        let _activeCallRoomId = null;
        let _activeCallTitle = '';
        let _activeCallTitleKey = '';

        function _getActiveCallTitle() {
            if (_activeCallTitleKey === 'audioCall') return tr('audioCall', 'Аудиозвонок');
            if (_activeCallTitleKey === 'videoCall') return tr('videoCall', 'Видеозвонок');
            return _activeCallTitle || tr('activeCallTitle', 'Звонок активен');
        }

        function _renderActiveCallBar() {
            const bar = document.getElementById('activeCallBar');
            if (!bar) return;

            const titleEl = document.getElementById('activeCallBarTitle');
            const statusEl = bar.querySelector('.active-call-status');
            const returnBtn = bar.querySelector('.active-call-return');
            const endBtn = bar.querySelector('.active-call-end');

            if (titleEl) titleEl.textContent = _getActiveCallTitle();
            if (statusEl) statusEl.textContent = tr('callInProgress', 'Идёт звонок');
            if (returnBtn) returnBtn.textContent = tr('returnToCall', 'Вернуться');
            if (endBtn) endBtn.title = tr('endCall', 'Завершить звонок');
        }

        function _openCallWindow(roomId, type, title, kind, chatId) {
            const url = '../calls/call.html?room=' + encodeURIComponent(roomId)
                + '&type=' + encodeURIComponent(type || 'group')
                + '&kind=' + encodeURIComponent(kind || 'video')
                + (title ? '&title=' + encodeURIComponent(title) : '')
                + (chatId ? '&chatId=' + encodeURIComponent(chatId) : '')
                + '&embedded=1';
            _activeCallRoomId = roomId;
            _activeCallTitleKey = title ? '' : (kind === 'audio' ? 'audioCall' : 'videoCall');
            _activeCallTitle = title || '';
            document.getElementById('callFrame').src = url;
            _showCallPanel();
        }

        function _showCallPanel() {
            const _panel = document.getElementById('callPanel');
            _panel.classList.remove('minimized');
            _panel.style.display = 'flex';
            document.getElementById('activeCallBar').style.display = 'none';
            document.getElementById('noChat').style.display = 'none';
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.add('hidden');
            const chatView = document.getElementById('chatView');
            chatView.classList.remove('active');
            document.body.classList.remove('chat-open');
            document.body.classList.add('call-open');
        }

        function _hideCallPanel() {
            document.body.classList.remove('call-open');
            const _panel = document.getElementById('callPanel');
            _panel.style.display = 'flex'; // iframe должен продолжать работать
            _panel.classList.add('minimized');
            if (_activeCallRoomId) {
                const bar = document.getElementById('activeCallBar');
                _renderActiveCallBar();
                bar.style.display = 'flex';
            }
            const sidebar = document.getElementById('sidebar');
            // Восстанавливаем предыдущий вид
            if (typeof activeChat !== 'undefined' && activeChat) {
                if (sidebar) sidebar.classList.add('hidden');
                document.getElementById('chatView').classList.add('active');
                document.body.classList.add('chat-open');
            } else {
                if (sidebar) sidebar.classList.remove('hidden');
                document.getElementById('noChat').style.display = '';
            }
        }

        function _endCall(fromBar) {
            document.body.classList.remove('call-open');
            if (fromBar) {
                // Команда завершить — передаём в iframe
                try { document.getElementById('callFrame').contentWindow.postMessage({ type: 'crane_hangup' }, '*'); } catch(_) {}
            }
            _activeCallRoomId = null;
            _activeCallTitle = '';
            _activeCallTitleKey = '';
            const _panel = document.getElementById('callPanel');
            _panel.classList.remove('minimized');
            _panel.style.display = 'none';
            document.getElementById('callFrame').src = '';
            document.getElementById('activeCallBar').style.display = 'none';
            const sidebar = document.getElementById('sidebar');
            if (typeof activeChat !== 'undefined' && activeChat) {
                if (sidebar) sidebar.classList.add('hidden');
                document.getElementById('chatView').classList.add('active');
                document.body.classList.add('chat-open');
            } else {
                if (sidebar) sidebar.classList.remove('hidden');
                document.getElementById('noChat').style.display = '';
            }
        }

        // Сообщения от iframe (call.html)
        window.addEventListener('message', (e) => {
            if (!e.data || typeof e.data !== 'object') return;
            if (e.data.type === 'crane_call_ended') _endCall(false);
            if (e.data.type === 'crane_call_minimize') _hideCallPanel();
            if (e.data.type === 'crane_add_peer') {
                _hideCallPanel();
                try { showToast && showToast('info', tr('chooseChatAndCall', 'Выберите чат и нажмите кнопку звонка')); } catch(_) {}
            }
        });

        async function _createCallRoom(type, chatId, title) {
            const roomId = (type === 'group' && chatId) ? _groupCallRoomId(chatId) : null;
            try {
                const token = localStorage.getItem('craneapp_auth_token');
                const res = await fetch('/api/v1/calls/rooms', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, chatId, title, roomId: roomId || undefined })
                });
                if (!res.ok) throw new Error('Failed');
                const data = await res.json();
                return data.room.id;
            } catch (e) {
                // Фолбэк — клиентский ID, /calls/call.html сам создаст комнату
                return roomId || _genRoomId();
            }
        }

        async function _startCallFromChat(kind) {
            if (!activeChat) { try { showToast && showToast('info','Выберите чат'); } catch(_){} return; }

            // Если уже идёт звонок — приглашаем собеседника присоединиться к нему
            if (_activeCallRoomId) {
                if (activeChat.type === 'group') {
                    const groupRoomId = _groupCallRoomId(activeChat.id);
                    if (groupRoomId && _activeCallRoomId === groupRoomId) {
                        _showCallPanel();
                        return;
                    }
                    try { showToast && showToast('info', tr('groupAddUnsupported', 'Групповое добавление из меню чата пока не поддерживается')); } catch(_){}
                    return;
                }
                const peerId = chatUsers[activeChat.id]?.id;
                if (!peerId || peerId === user.id) {
                    try { showToast && showToast('info', tr('peerNotFound', 'Не удалось найти собеседника')); } catch(_){}
                    return;
                }
                try {
                    const ws = window.craneWs || window.ws;
                    if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({
                            type: 'call_invite', to: peerId, roomId: _activeCallRoomId,
                            callType: 'group', kind,
                            fromName: user.firstName || user.username, fromAvatar: user.avatarUrl || null,
                            title: _activeCallTitle
                        }));
                        try { showToast && showToast('success', tr('inviteSent', 'Приглашение отправлено')); } catch(_){}
                    }
                } catch(_) {}
                _showCallPanel();
                return;
            }

            const _callBtn = document.getElementById(kind === 'audio' ? 'audioCallBtn' : 'videoCallBtn');
            const isGroup = activeChat.type === 'group';
            const kindLabel = kind === 'audio' ? tr('audioCall', 'Аудиозвонок') : tr('videoCall', 'Видеозвонок');
            const title = activeChat.name || (isGroup ? tr('groupCall', 'Групповой звонок') : kindLabel);
            const roomId = await _createCallRoom(isGroup ? 'group' : 'p2p', activeChat.id, title);
            try {
                const ws = window.craneWs || window.ws;
                if (ws && ws.readyState === 1) {
                    // Для личного чата берём ID собеседника из chatUsers
                    let targets = [];
                    if (!isGroup) {
                        const peerId = chatUsers[activeChat.id]?.id;
                        if (peerId && peerId !== user.id) targets = [peerId];
                    } else {
                        // Для группы — запрашиваем участников через API
                        try {
                            const token = localStorage.getItem('craneapp_auth_token');
                            const r = await fetch('/api/v1/chats/' + activeChat.id + '/members', {
                                headers: { 'Authorization': 'Bearer ' + token }
                            });
                            if (r.ok) {
                                const d = await r.json();
                                targets = (d.members || []).map(m => m.id || m.userId).filter(id => id && id !== user.id);
                            }
                        } catch(_) {}
                    }
                    if (targets.length === 0) {
                        try { showToast('Не удалось найти собеседника'); } catch(_){}
                    }
                    const invitePayloads = targets.map(to => ({
                        type: 'call_invite', to, roomId,
                        kind, fromName: user.firstName || user.username, fromAvatar: user.avatarUrl || null,
                        title,
                        callType: isGroup ? 'group' : 'p2p',
                        chatId: isGroup ? activeChat.id : null
                    }));
                    // Отправляем сразу, потом повторяем 2 раза с интервалом 3 сек
                    // (защита от zombie-соединений на мобильных сетях)
                    function sendInvites() {
                        const w = window.craneWs || window.ws;
                        if (w && w.readyState === WebSocket.OPEN) {
                            invitePayloads.forEach(p => w.send(JSON.stringify(p)));
                        }
                    }
                    sendInvites();
                    const retryInvite1 = setTimeout(sendInvites, 3000);
                    const retryInvite2 = setTimeout(sendInvites, 6000);
                    // Отменяем повторы если собеседник ответил
                    const cancelRetry = () => { clearTimeout(retryInvite1); clearTimeout(retryInvite2); };
                    window._cancelCallInviteRetry = cancelRetry;
                }
            } catch (_) {}
            _openCallWindow(roomId, isGroup ? 'group' : 'p2p', title, kind, isGroup ? activeChat.id : null);
        }

        function startVideoCallFromChat() { return _startCallFromChat('video'); }
        function startAudioCallFromChat() { return _startCallFromChat('audio'); }

        // Рингтон через WebAudio (имитация классического звонка) + вибрация
        let _ringtoneCtx = null, _ringtoneTimer = null, _vibrateTimer = null;
        function _startRingtone(){
            _stopRingtone();
            try {
                _ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)();
                const ctx = _ringtoneCtx;
                // Классическая двухтоновая мелодия звонка (пара звуковых импульсов, потом пауза)
                const ring = () => {
                    if (!_ringtoneCtx) return;
                    const t0 = ctx.currentTime;
                    [0, 0.5].forEach(off => {
                        const o1 = ctx.createOscillator();
                        const g1 = ctx.createGain();
                        o1.type = 'sine';
                        o1.frequency.value = 440;
                        g1.gain.setValueAtTime(0, t0 + off);
                        g1.gain.linearRampToValueAtTime(0.55, t0 + off + 0.04);
                        g1.gain.setValueAtTime(0.55, t0 + off + 0.32);
                        g1.gain.linearRampToValueAtTime(0, t0 + off + 0.40);
                        const o2 = ctx.createOscillator();
                        const g2 = ctx.createGain();
                        o2.type = 'sine';
                        o2.frequency.value = 480;
                        g2.gain.setValueAtTime(0, t0 + off);
                        g2.gain.linearRampToValueAtTime(0.45, t0 + off + 0.04);
                        g2.gain.setValueAtTime(0.45, t0 + off + 0.32);
                        g2.gain.linearRampToValueAtTime(0, t0 + off + 0.40);
                        o1.connect(g1).connect(ctx.destination);
                        o2.connect(g2).connect(ctx.destination);
                        o1.start(t0 + off); o1.stop(t0 + off + 0.42);
                        o2.start(t0 + off); o2.stop(t0 + off + 0.42);
                    });
                };
                ring();
                _ringtoneTimer = setInterval(ring, 2000);
                // Вибрация на мобильных — паттерн как у звонка
                if (navigator.vibrate) {
                    const vibrate = () => navigator.vibrate([400, 200, 400, 1000]);
                    vibrate();
                    _vibrateTimer = setInterval(vibrate, 2000);
                }
            } catch(_){}
        }
        function _stopRingtone(){
            if (_ringtoneTimer) { clearInterval(_ringtoneTimer); _ringtoneTimer = null; }
            if (_vibrateTimer) { clearInterval(_vibrateTimer); _vibrateTimer = null; }
            if (navigator.vibrate) { try { navigator.vibrate(0); } catch(_){} }
            if (_ringtoneCtx) { try { _ringtoneCtx.close(); } catch(_){} _ringtoneCtx = null; }
        }

        function _showIncomingCall(payload) {
            if (_incomingCall && _incomingCall.roomId === payload.roomId) return;
            _incomingCall = payload;
            const banner = document.getElementById('incomingCallBanner');
            const nameEl = document.getElementById('incomingName');
            const avEl = document.getElementById('incomingAvatar');
            const kindLabel = document.getElementById('incomingKindLabel');
            const kindIcon = document.getElementById('incomingKindIcon');
            if (!banner) return;
            nameEl.textContent = payload.fromName || payload.title || tr('unknownUser', 'Неизвестный');
            const initial = (payload.fromName || '?').charAt(0).toUpperCase();
            avEl.innerHTML = payload.fromAvatar
                ? '<img src="'+payload.fromAvatar+'" alt="">'
                : initial;
            const isAudio = payload.kind === 'audio';
        kindLabel.textContent = isAudio ? tr('audioCall', 'Аудиозвонок') : tr('videoCall', 'Видеозвонок');
// removed redundant line
kindIcon.innerHTML = isAudio ? '📞' : '📹';
            banner.classList.add('show');
            try { _startRingtone(); } catch(_){}
            // Авто-скрытие через 35 сек
            clearTimeout(_showIncomingCall._t);
            _showIncomingCall._t = setTimeout(() => rejectIncomingCall(), 35000);
        }

        function _hideIncomingCallBanner(){
            const banner = document.getElementById('incomingCallBanner');
            if (banner) banner.classList.remove('show');
            clearTimeout(_showIncomingCall._t);
        }

        function acceptIncomingCall() {
            if (!_incomingCall) return;
            const c = _incomingCall;
            try {
                const ws = window.craneWs || window.ws;
                if (ws && ws.readyState === 1) {
                    ws.send(JSON.stringify({ type:'call_invite_response', to: c.from, roomId: c.roomId, accepted: true }));
                }
            } catch(_){}
            try { _stopRingtone(); } catch(_){}
            _hideIncomingCallBanner();
            // Сообщаем другим вкладкам — они прекратят звонить
            try { _callTabChannel && _callTabChannel.postMessage({ type: 'call_tab_handled', roomId: c.roomId }); } catch(_) {}
            const kind = (c.kind === 'audio') ? 'audio' : 'video';
            const callType = c.callType || (c.roomId && String(c.roomId).startsWith('grp_') ? 'group' : 'p2p');
            const chatId = c.chatId || null;
            _openCallWindow(c.roomId, callType, c.title || c.fromName || (kind === 'audio' ? tr('audioCall', 'Аудиозвонок') : tr('videoCall', 'Видеозвонок')), kind, chatId);
            _incomingCall = null;
        }

        function rejectIncomingCall() {
            try { _stopRingtone(); } catch(_){}
            if (!_incomingCall) { _hideIncomingCallBanner(); return; }
            const c = _incomingCall;
            try {
                const ws = window.craneWs || window.ws;
                if (ws && ws.readyState === 1) {
                    ws.send(JSON.stringify({ type:'call_invite_response', to: c.from, roomId: c.roomId, accepted: false }));
                }
            } catch(_){}
            // Сообщаем другим вкладкам — они прекратят звонить
            try { _callTabChannel && _callTabChannel.postMessage({ type: 'call_tab_handled', roomId: c.roomId }); } catch(_) {}
            _hideIncomingCallBanner();
            _incomingCall = null;
        }

        async function startInstantMeeting() {
            const title = 'Встреча — ' + (user.firstName || user.username || 'CraneApp');
            const roomId = await _createCallRoom('group', null, title);
            _openCallWindow(roomId, 'group', title);
        }
        function joinMeetingByLink() {
            const url = prompt('Вставьте ссылку или ID комнаты:');
            if (!url) return;
            let roomId = url.trim();
            try {
                if (roomId.includes('?')) {
                    const u = new URL(roomId, location.origin);
                    roomId = u.searchParams.get('room') || roomId;
                }
            } catch(_) {}
            if (!roomId) return;
            _openCallWindow(roomId, 'group', 'Встреча');
        }

        // Глобальный перехват входящих звонков из WebSocket
        // (вешается после инициализации основного WS-клиента)
        window.__handleIncomingCallMessage = function(msg) {
            if (msg && msg.type === 'call_incoming') {
                _showIncomingCall(msg);
                return true;
            }
            return false;
        };

        // ============================================
        // SECTION TABS (ЛС / Чаты / Каналы / Сообщества / Встречи)
        // ============================================
        let currentSection = 'dms';
        function switchSection(section) {
            currentSection = section;
            document.querySelectorAll('.rail-tab').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === section);
            });
            // Заголовок sidebar
            const titleEl = document.querySelector('.sidebar .top-header .top-title');
            if (titleEl) {
                const titles = {
                    dms: tr('privateMessages', 'Личные сообщения'),
                    chats: tr('chats', 'Чаты'),
                    channels: tr('channels', 'Каналы'),
                    communities: tr('communities', 'Сообщества'),
                    meetings: tr('meetings', 'Встречи')
                };
                titleEl.textContent = titles[section] || tr('chats', 'Чаты');
            }
            applySectionFilter(section);
        }

        function applySectionFilter(section) {
            const list = document.getElementById('chatList');
            if (!list) return;

            // Заглушка для нереализованных разделов
            let placeholder = document.getElementById('sectionPlaceholder');
            if (!placeholder) {
                placeholder = document.createElement('div');
                placeholder.id = 'sectionPlaceholder';
                placeholder.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 24px;text-align:center;color:var(--rd-text-2,rgba(235,235,245,0.72));font-family:var(--font-geologica,sans-serif);';
            }

            const showPlaceholder = (icon, title, subtitle) => {
                placeholder.innerHTML =
                    '<div class="section-placeholder-icon">' + icon + '</div>' +
                    '<div style="font-size:17px;font-weight:700;color:var(--rd-text,#fff);letter-spacing:-0.01em;margin-bottom:6px;">' + title + '</div>' +
                    '<div style="font-size:13px;color:var(--rd-text-3,rgba(235,235,245,0.46));max-width:260px;line-height:1.45;">' + subtitle + '</div>';
                Array.from(list.children).forEach(ch => {
                    if (ch.id !== 'sectionPlaceholder') ch.style.display = 'none';
                });
                if (!placeholder.parentElement) list.appendChild(placeholder);
                placeholder.style.display = 'flex';
            };

            const restoreList = () => {
                if (placeholder.parentElement) placeholder.style.display = 'none';
                Array.from(list.children).forEach(ch => {
                    if (ch.id !== 'sectionPlaceholder') ch.style.display = '';
                });
            };

            const dmIcon = '✉';
            const groupIcon = '👥';
            const channelIconHtml = typeof window.chIcon === 'function'
                ? '<div class="section-placeholder-icon">' + window.chIcon('broadcast', 28) + '</div>'
                : '<div class="section-placeholder-icon"></div>';
            const commIcon = '💬';
            const meetIcon = '📹';

            if (section === 'channels') {
                restoreList();
                const items = list.querySelectorAll('.chat-item');
                let visibleCount = 0;
                items.forEach(it => {
                    const type = (it.dataset.chatType || '').toLowerCase();
                    const show = type === 'channel';
                    it.style.display = show ? '' : 'none';
                    if (show) visibleCount++;
                });
                if (visibleCount === 0) {
                    placeholder.style.display = 'flex';
                    if (!placeholder.parentElement) list.appendChild(placeholder);
                    const channelsDesc = tr('channelsEmptyDesc', 'Подпишитесь на каналы или создайте свой');
                    const channelsDescMatch = channelsDesc.match(/^(.+?)\s+или\s+(.+)$/i);
                    const channelsDescHtml = channelsDescMatch
                        ? escapeHtml(channelsDescMatch[1]) + '<br>или ' + escapeHtml(channelsDescMatch[2])
                        : escapeHtml(channelsDesc);
                    placeholder.innerHTML =
                        channelIconHtml +
                        '<div style="font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">' + tr('channels', 'Каналы') + '</div>' +
                        '<div class="channels-empty-desc">' + channelsDescHtml + '</div>' +
                        '<div class="channels-empty-actions">' +
                        '<button type="button" class="channels-empty-btn channels-empty-btn--primary" onclick="openCreateChannelModal()">' + tr('createChannel', 'Создать канал') + '</button>' +
                        '<button type="button" class="channels-empty-btn channels-empty-btn--secondary" onclick="openChannelDiscovery()">' + tr('findChannels', 'Найти каналы') + '</button>' +
                        '</div>';
                }
            } else if (section === 'communities') {
                showPlaceholder(commIcon, tr('communities', 'Сообщества'), tr('communitiesSectionDesc', 'Раздел в разработке. Скоро вы сможете объединять чаты и каналы в сообщества.'));
            } else if (section === 'meetings') {
                Array.from(list.children).forEach(ch => {
                    if (ch.id !== 'sectionPlaceholder') ch.style.display = 'none';
                });
                if (!placeholder.parentElement) list.appendChild(placeholder);
                placeholder.style.display = 'flex';
                placeholder.innerHTML =
                    '<div style="width:72px;height:72px;border-radius:20px;background:linear-gradient(135deg,#9b82ff,#5a8bff);display:flex;align-items:center;justify-content:center;margin-bottom:18px;box-shadow:0 14px 36px rgba(90,139,255,0.36);">' + meetIcon + '</div>' +
                    '<div style="font-size:18px;font-weight:700;color:var(--rd-text,#fff);letter-spacing:-0.01em;margin-bottom:6px;">' + escapeHtml(tr('meetings', 'Встречи')) + '</div>' +
                    '<div style="font-size:13px;color:var(--rd-text-3,rgba(235,235,245,0.46));max-width:280px;line-height:1.45;margin-bottom:18px;">' + escapeHtml(tr('meetingsDesc', 'Создайте видеовстречу и пригласите участников по ссылке. До 5 человек.')) + '</div>' +
                    '<button onclick="startInstantMeeting()" style="height:46px;padding:0 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#9b82ff,#5a8bff);color:#fff;font-family:Geologica,sans-serif;font-weight:600;font-size:14px;letter-spacing:-0.01em;cursor:pointer;box-shadow:0 12px 28px rgba(90,139,255,0.32);">' + escapeHtml(tr('startMeeting', '+ Начать встречу')) + '</button>' +
                    '<button onclick="joinMeetingByLink()" style="margin-top:10px;height:42px;padding:0 22px;border-radius:12px;border:1px solid var(--rd-stroke,rgba(255,255,255,0.1));background:transparent;color:var(--rd-text,#fff);font-family:Geologica,sans-serif;font-weight:500;font-size:13.5px;cursor:pointer;">' + escapeHtml(tr('joinByLink', 'Войти по ссылке…')) + '</button>';
            } else {
                // dms / chats — фильтруем уже отрендеренные элементы списка
                restoreList();
                const items = list.querySelectorAll('.chat-item');
                let visibleCount = 0;
                items.forEach(it => {
                    const type = (it.dataset.chatType || 'private').toLowerCase();
                    const isPrivate = type === 'private' || type === 'dm' || type === 'personal';
                    const isChannel = type === 'channel';
                    const show = (section === 'dms' && isPrivate)
                        || (section === 'chats' && !isPrivate && !isChannel);
                    it.style.display = show ? '' : 'none';
                    if (show) visibleCount++;
                });
                if (visibleCount === 0) {
                    showPlaceholder(section === 'dms' ? dmIcon : groupIcon,
                        section === 'dms' ? tr('directMessagesEmpty', 'Личных сообщений пока нет') : tr('groupChatsEmpty', 'Групповых чатов пока нет'),
                        'Создайте новый чат, нажав «+» в правом верхнем углу.');
                }
            }
        }

        // Применяем фильтр после загрузки списка
        const _origObserverTarget = document.getElementById('chatList');
        if (_origObserverTarget) {
            const _mo = new MutationObserver(() => applySectionFilter(currentSection));
            _mo.observe(_origObserverTarget, { childList: true, subtree: false });
        }

        function updateSideMenuProfile() {
            try {
                const nameEl = document.getElementById('sideMenuName');
                const usernameEl = document.getElementById('sideMenuUsername');
                const avatarEl = document.getElementById('sideMenuAvatar');
                if (!nameEl || !usernameEl || !avatarEl) return;
                
                const safeUser = user || {};
                const fName = String(safeUser.firstName || '');
                const lName = String(safeUser.lastName || '');
                const uName = safeUser.username ? String(safeUser.username) : '';
                
                const displayName = (fName + ' ' + lName).trim() || uName || tr('user', 'Пользователь');
                nameEl.removeAttribute('data-i18n');
                
                usernameEl.textContent = safeUser.username ? '@' + safeUser.username : '@username';

                // Badge + Premium
                const badgesHtml = renderBadges(safeUser.badges || [], safeUser.isBot, safeUser.isPremium, safeUser.isFake, safeUser.isScam);
                if (badgesHtml) {
                    nameEl.innerHTML = escapeHtml(String(displayName)) + badgesHtml;
                } else {
                    nameEl.textContent = displayName;
                }
                renderSideMenuAvatar(safeUser.avatarUrl, String(displayName));
            } catch (e) {
                console.error("Error in updateSideMenuProfile:", e);
            }
        }

        function renderSideMenuAvatar(url, name) {
            const avatarEl = document.getElementById('sideMenuAvatar');
            if (!avatarEl) return;
            avatarEl.innerHTML = '';

            if (url && (url.startsWith('data:image') || url.startsWith('http') || url.startsWith('/'))) {
                const img = document.createElement('img');
                img.src = url;
                img.alt = '';
                avatarEl.appendChild(img);
                avatarEl.style.background = 'transparent';
                return;
            }

            const span = document.createElement('span');
            const displayName = name || user.firstName || user.username || '👤';
            span.textContent = (displayName[0] || '👤').toUpperCase();
            avatarEl.appendChild(span);
            avatarEl.style.background = getAvatarGradient(displayName);
        }

        function openSideMenuAvatarPicker() {
            const input = document.getElementById('sideMenuAvatarInput');
            if (input) input.click();
        }

        function readFileAsDataUrl(file) {
            return new Promise(function(resolve, reject) {
                const reader = new FileReader();
                reader.onload = function(e) { resolve(e.target.result); };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        async function handleSideMenuAvatarChange(input) {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;

            if (!file.type || !file.type.startsWith('image/')) {
                showToast('error', tr('avatarImageOnly', 'Choose an image file'), '❌');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                showToast('error', tr('fileTooLarge5', 'File is too large (max. 5 MB)'), '❌');
                return;
            }

            const wrap = document.querySelector('.side-menu-avatar-wrap');
            const previousAvatarUrl = user.avatarUrl || '';
            if (wrap) wrap.classList.add('is-uploading');

            try {
                const avatarBase64 = await readFileAsDataUrl(file);
                const displayName = ((user.firstName || '') + ' ' + (user.lastName || '')).trim() || user.username || tr('user', 'User');
                renderSideMenuAvatar(avatarBase64, displayName);

                const res = await fetch('/api/v1/users/avatar', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ avatar: avatarBase64 })
                });
                const data = await res.json().catch(function() { return {}; });
                if (!res.ok) throw new Error(data.error || tr('saveError', 'Save error'));

                user = { ...user, avatarUrl: data.avatarUrl || avatarBase64 };
                const cached = JSON.parse(localStorage.getItem('craneapp_user_data') || '{}');
                localStorage.setItem('craneapp_user_data', JSON.stringify({ ...cached, ...user }));
                updateSideMenuProfile();
                showToast('success', tr('avatarUpdated', 'Profile photo updated'), '✓');
            } catch (err) {
                user.avatarUrl = previousAvatarUrl;
                updateSideMenuProfile();
                showToast('error', err.message || tr('avatarUpdateError', 'Could not update profile photo'), '❌');
            } finally {
                if (wrap) wrap.classList.remove('is-uploading');
            }
        }
            
        function logout() {
            closeSideMenu();
            if (confirm(window.i18n?.t('logoutConfirm') || 'Выйти из аккаунта?')) {
                localStorage.removeItem('craneapp_auth_token');
                localStorage.removeItem('craneapp_user_data');
                window.location.href = '../auth/login.html';
            }
        }

        // ============================================
        // MODALS
        // ============================================
        function openSearchModal() {
            document.getElementById('searchModal').classList.add('active');
            setTimeout(() => document.getElementById('modalSearchInput').focus(), 100);
        }

               function closeSearchModal() {
            document.getElementById('searchModal').classList.remove('active');
            document.getElementById('modalSearchInput').value = '';
            document.getElementById('modalResults').innerHTML = '<div class="modal-empty"><div class="modal-empty-icon">👥</div><div>' + tr('writeUsernameForSearch', 'Введите юзернейм для поиска') + '</div></div>';
            document.getElementById('modalStatus').classList.remove('visible');
        }

        function openCreateModal() {
            document.getElementById('createModal').classList.add('active');
        }

        function closeCreateModal() {
            document.getElementById('createModal').classList.remove('active');
        }

        document.getElementById('searchModal').addEventListener('click', function(e) { 
            if (e.target.id === 'searchModal') closeSearchModal(); 
        });
        
        document.getElementById('createModal').addEventListener('click', function(e) { 
            if (e.target.id === 'createModal') closeCreateModal(); 
        });

        // ============================================
        // USER PROFILE MODAL (Telegram-style)
        // ============================================
        function toggleProfileMenu() {
            const menu = document.getElementById('profileMenu');
            menu.classList.toggle('active');
        }
        
        function switchProfileTab(tab) {
            // Убираем active у всех табов
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.profile-tab-pane').forEach(p => p.classList.remove('active'));
            
            // Добавляем active нужному табу
            document.querySelector(`.profile-tab[data-tab="${tab}"]`).classList.add('active');
            document.getElementById(`tab-${tab}`).classList.add('active');
        }
        
        // Текущий пользователь профиля
        let currentProfileUser = null;

        function toggleProfileNotifications() {
            const checkbox = document.getElementById('profileNotifications');
            if (!currentProfileUser) return;
            
            // Сохраняем в localStorage
            const notifications = JSON.parse(localStorage.getItem('chatNotifications') || '{}');
            notifications[currentProfileUser.id] = checkbox.checked;
            localStorage.setItem('chatNotifications', JSON.stringify(notifications));
            
            showToast('success', checkbox.checked ? (window.i18n?.t('notificationsOn') || 'Уведомления включены') : (window.i18n?.t('notificationsOff') || 'Уведомления отключены'), '🔔');
        }
        
        function reportUser() {
            toggleProfileMenu();
            if (!currentProfileUser) return;
            
            // Открываем модальное окно с формой жалобы
            document.getElementById('reportReason').value = 'spam';
            document.getElementById('reportDescription').value = '';
            document.getElementById('reportModal').classList.add('active');
        }
        
        function closeReportModal() {
            document.getElementById('reportModal').classList.remove('active');
        }
        
        async function submitReport() {
            if (!currentProfileUser) return;
            
            const reason = document.getElementById('reportReason').value;
            const description = document.getElementById('reportDescription').value;
            
            if (!reason) {
                showToast('error', tr('chooseReason', 'Выберите причину'), '❌');
                return;
            }
            
            try {
                const res = await fetch('/api/v1/reports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ 
                        reportedUserId: currentProfileUser.id,
                        reason,
                        description
                    })
                });
                
                if (res.ok) {
                    showToast('success', tr('reportSent', 'Жалоба отправлена'), '📮');
                    closeReportModal();
                } else {
                    showToast('error', tr('sendError', 'Ошибка отправки'), '❌');
                }
            } catch (err) {
                showToast('error', tr('networkError', 'Ошибка сети'), '❌');
            }
        }
        
        function copyProfileUsername() {
            if (!currentProfileUser) return;
            const username = currentProfileUser.username || '';
            if (!username) {
                showToast('error', tr('noUsername', 'Нет юзернейма'), '❌');
                return;
            }
            navigator.clipboard.writeText('@' + username).then(() => {
                showToast('success', tr('usernameCopied', 'Юзернейм скопирован'), '📋');
            }).catch(() => {
                showToast('error', tr('copyError', 'Ошибка копирования'), '❌');
            });
        }
        
        async function openQrCodeModal() {
            if (!currentProfileUser) return;
            if (currentProfileUser.isBlocked) {
                showToast('error', tr('blockedQrError', 'Нельзя открыть QR-код заблокированного пользователя'), '❌');
                return;
            }
            const username = currentProfileUser.username || '';
            if (!username) {
                showToast('error', tr('noUsername', 'Нет юзернейма'), '❌');
                return;
            }
            
            const modal = document.getElementById('qrCodeModal');
            const qrImage = document.getElementById('qrCodeImage');
            const qrUsername = document.getElementById('qrCodeUsername');
            
            qrUsername.textContent = '@' + username;
            qrImage.innerHTML = '<div style="width: 200px; height: 200px; background: var(--bg-tertiary); border-radius: 12px; display: flex; align-items: center; justify-content: center;"><span style="color: var(--text-muted);">' + tr('loading', 'Загрузка...') + '</span></div>';
            modal.classList.add('active');
            
            try {
                // Генерируем QR-код через API
                const res = await fetch('/api/v1/users/qr-code?username=' + encodeURIComponent(username), {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                
                if (data.qrCode) {
                    qrImage.innerHTML = `<img src="${data.qrCode}" style="width: 200px; height: 200px; border-radius: 12px;">`;
                } else {
                    qrImage.innerHTML = '<div style="width: 200px; height: 200px; background: var(--bg-tertiary); border-radius: 12px; display: flex; align-items: center; justify-content: center;"><span style="color: var(--text-muted);">' + tr('error', 'Ошибка') + '</span></div>';
                }
            } catch (err) {
                qrImage.innerHTML = '<div style="width: 200px; height: 200px; background: var(--bg-tertiary); border-radius: 12px; display: flex; align-items: center; justify-content: center;"><span style="color: var(--text-muted);">' + tr('networkError', 'Ошибка сети') + '</span></div>';
            }
        }
        
        function closeQrCodeModal() {
            document.getElementById('qrCodeModal').classList.remove('active');
        }
        
        async function archiveUser() {
            toggleProfileMenu();
            if (!currentProfileUser) return;
            
            // Ищем чат с пользователем
            const chatWithUser = allChats.find(c => {
                const cu = chatUsers[c.id];
                return cu && cu.id === currentProfileUser.id;
            });
            
            if (!chatWithUser) {
                showToast('error', tr('chatNotFound', 'Чат не найден'), '❌');
                return;
            }
            
            // Архивируем через API
            try {
                const res = await fetch(`/api/v1/chats/${chatWithUser.id}/archive`, {
                    method: 'POST',
                    headers: { 
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (res.ok) {
                    showToast('success', tr('chatArchived', 'Чат архивирован'), '📁');
                    await loadArchivedChats();
                    loadChats();
                } else {
                    showToast('error', tr('archiveError', 'Ошибка архивирования'), '❌');
                }
            } catch (err) {
                showToast('error', tr('networkError', 'Ошибка сети'), '❌');
            }
        }
        
        // Переменная для хранения данных при добавлении в папку
        let folderSelectChatId = null;
        let folderSelectData = [];

        function getFolderChatIds(folder) {
            if (!folder) return [];
            if (!Array.isArray(folder.chatIds)) {
                folder.chatIds = Array.isArray(folder.chats) ? folder.chats : [];
            }
            return folder.chatIds;
        }

        async function addToFolder() {
            toggleProfileMenu();
            if (!currentProfileUser) return;
            
            // Ищем чат с пользователем
            const chatWithUser = allChats.find(c => {
                const cu = chatUsers[c.id];
                return cu && cu.id === currentProfileUser.id;
            });
            
            if (!chatWithUser) {
                showToast('error', tr('chatNotFound', 'Чат не найден'), '❌');
                return;
            }
            
            folderSelectChatId = chatWithUser.id;
            await openFolderSelectModal();
        }

        async function openFolderSelectModal() {
            const modal = document.getElementById('folderSelectModal');
            const list = document.getElementById('folderSelectList');
            
            list.innerHTML = '<div class="folder-loading">' + tr('loadingFolders', 'Загрузка папок...') + '</div>';
            modal.classList.add('active');
            
            try {
                const res = await fetch('/api/v1/users/folders', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                folderSelectData = data.folders || [];
                
                if (folderSelectData.length === 0) {
                    list.innerHTML = '<div class="folder-empty">' + tr('noFoldersSettings', 'У вас нет папок.<br>Создайте их в настройках.') + '</div>';
                    return;
                }
                
                list.innerHTML = '';
                folderSelectData.forEach((folder, index) => {
                    const item = document.createElement('div');
                    item.className = 'folder-item';
                    item.onclick = () => selectFolder(index);
                    const chatIds = getFolderChatIds(folder);
                    const isInFolder = chatIds.includes(folderSelectChatId);
                    item.innerHTML = `
                        <div class="folder-item-icon">${folder.icon || '📂'}</div>
                        <div class="folder-item-info">
                            <div class="folder-item-name">${folder.name}</div>
                            <div class="folder-item-count">${chatIds.length} чатов ${isInFolder ? '(уже в папке)' : ''}</div>
                        </div>
                        ${isInFolder ? '✓' : ''}
                    `;
                    list.appendChild(item);
                });
            } catch (err) {
                list.innerHTML = '<div class="folder-empty">' + tr('folderLoadError', 'Ошибка загрузки папок') + '</div>';
            }
        }

        async function selectFolder(index) {
            if (!folderSelectChatId || index < 0 || index >= folderSelectData.length) return;
            
            const folder = folderSelectData[index];
            const chatIds = getFolderChatIds(folder);
            
            if (chatIds.includes(folderSelectChatId)) {
                showToast('info', tr('chatAlreadyInFolder', 'Чат уже в этой папке'), '📂');
                closeFolderSelectModal();
                return;
            }
            
            chatIds.push(folderSelectChatId);
            
            try {
                const saveRes = await fetch('/api/v1/users/folders', {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token 
                    },
                    body: JSON.stringify({ folders: folderSelectData })
                });
                if (!saveRes.ok) throw new Error('folder save failed');
                
                showToast('success', `Чат добавлен в папку "${folder.name}"`, '📂');
                localStorage.setItem('craneapp_folders', JSON.stringify(folderSelectData));
                initFolderTabs();
                renderChatList();
                closeFolderSelectModal();
            } catch (err) {
                showToast('error', tr('saveError', 'Ошибка сохранения'), '❌');
            }
        }

        function closeFolderSelectModal() {
            document.getElementById('folderSelectModal').classList.remove('active');
            folderSelectChatId = null;
        }

        function createNewFolder() {
            closeFolderSelectModal();
            showToast('info', tr('folderCreateInSettings', 'Создание папок в настройках'), '📂');
        }
        
        // Загрузка данных для табов профиля
        function loadProfileMedia(userId) {
            const grid = document.getElementById('profileMediaGrid');
            grid.innerHTML = '';
            
            // Ищем медиа в сообщениях с этим пользователем
            const media = [];
            Object.values(messagesData).forEach(msg => {
                if ((msg.senderId === userId || msg.chatId === activeChat?.id) && 
                    (msg.type === 'image' || msg.type === 'photo' || msg.type === 'video')) {
                    media.push(msg);
                }
            });
            
            if (media.length === 0) {
                grid.innerHTML = '<div class="profile-empty">' + tr('noMediaFiles', 'Нет медиафайлов') + '</div>';
                return;
            }
            
            media.slice(0, 20).forEach(m => {
                const div = document.createElement('div');
                div.className = 'profile-media-item';
                if (m.mediaUrl || m.fileUrl) {
                    div.innerHTML = `<img src="${m.mediaUrl || m.fileUrl}" loading="lazy">`;
                    div.onclick = () => openMediaPreview(m.mediaUrl || m.fileUrl, m.type || 'image');
                }
                grid.appendChild(div);
            });
        }
        
        function loadProfileFiles(userId) {
            const list = document.getElementById('profileFilesList');
            list.innerHTML = '';
            
            const files = Object.values(messagesData).filter(msg => 
                (msg.senderId === userId || msg.chatId === activeChat?.id) && 
                msg.type === 'file'
            );
            
            if (files.length === 0) {
                list.innerHTML = '<div class="profile-empty">' + tr('noFiles', 'Нет файлов') + '</div>';
                return;
            }
            
            files.slice(0, 20).forEach(f => {
                const div = document.createElement('div');
                div.className = 'profile-file-item';
                div.innerHTML = `
                    <div class="file-icon">📄</div>
                    <div class="file-info">
                        <div class="file-name">${f.fileName || tr('fileMedia', 'Файл')}</div>
                        <div class="file-size">${f.fileSize || ''}</div>
                    </div>
                `;
                if (f.fileUrl) {
                    div.onclick = () => window.open(f.fileUrl, '_blank');
                }
                list.appendChild(div);
            });
        }
        
        function loadProfileLinks(userId) {
            const list = document.getElementById('profileLinksList');
            list.innerHTML = '';
            
            const links = [];
            Object.values(messagesData).forEach(msg => {
                if (msg.senderId === userId || msg.chatId === activeChat?.id) {
                    const content = msg.content || msg.text || '';
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    const matches = content.match(urlRegex);
                    if (matches) links.push(...matches);
                }
            });
            
            if (links.length === 0) {
                list.innerHTML = '<div class="profile-empty">' + tr('noLinks', 'Нет ссылок') + '</div>';
                return;
            }
            
            [...new Set(links)].slice(0, 20).forEach(url => {
                const div = document.createElement('div');
                div.className = 'profile-link-item';
                div.innerHTML = `<div class="link-url">🔗 ${url.substring(0, 50)}${url.length > 50 ? '...' : ''}</div>`;
                div.onclick = () => window.open(url, '_blank');
                list.appendChild(div);
            });
        }
        
        function loadProfileGroups(userId) {
            const list = document.getElementById('profileGroupsList');
            list.innerHTML = '';
            
            // Ищем группы где есть оба пользователя
            const commonGroups = allChats.filter(c => {
                if (c.type !== 'group') return false;
                const members = c.members || [];
                return members.includes(userId) && members.includes(user?.id);
            });
            
            if (commonGroups.length === 0) {
                list.innerHTML = '<div class="profile-empty">' + tr('noCommonGroups', 'Нет общих групп') + '</div>';
                return;
            }
            
            commonGroups.forEach(g => {
                const div = document.createElement('div');
                div.className = 'profile-group-item';
                div.innerHTML = `
                    <div class="group-avatar">👥</div>
                    <div class="group-info">
                        <div class="group-name">${g.name}</div>
                        <div class="group-members">${g.members?.length || 0} участников</div>
                    </div>
                `;
                div.onclick = () => {
                    closeUserProfileModal();
                    openChat(g.id, g.name);
                };
                list.appendChild(div);
            });
        }
        
        function openUserProfileModal(userData) {
            const avatarEl = document.getElementById('profileAvatar');
            const nameEl = document.getElementById('profileName');
            const usernameEl = document.getElementById('profileUsername');
            const statusEl = document.getElementById('profileStatus');
            const bioLine = document.getElementById('profileBioLine');
            const chatBtn = document.getElementById('profileChatBtn');

            // Убираем старое описание и используем новое
            const bioEl = document.getElementById('profileBio');

            // Проверяем заблокирован ли пользователь
            const isBlocked = userData.isBlocked || false;

            // Аватарка пользователя
            if (isBlocked) {
                // SVG иконка призрака для заблокированных
                avatarEl.innerHTML = '<svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18v-6a3 3 0 0 1 6 0v6"/><path d="M6 18a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-6a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v6z"/><path d="M12 2a5 5 0 0 0-5 5v2h10V7a5 5 0 0 0-5-5z"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="16" r="1"/></svg>';
                avatarEl.style.background = '#333';
            } else if (userData.username === 'craneapp_bot') {
                // Журавль для бота CraneApp
                avatarEl.innerHTML = '<img src="/logo.png" alt="">';
                avatarEl.style.background = 'transparent';
            } else if (userData.avatarUrl && (userData.avatarUrl.startsWith('data:image') || userData.avatarUrl.startsWith('http') || userData.avatarUrl.startsWith('/'))) {
                avatarEl.innerHTML = '<img src="' + userData.avatarUrl + '" alt="">';
                avatarEl.style.background = 'transparent';
            } else if (userData.isBot) {
                avatarEl.innerHTML = '<span style="font-size: 60px;">🤖</span>';
                avatarEl.style.background = 'transparent';
            } else {
                const displayName = userData.name || userData.username || '👤';
                avatarEl.innerHTML = '<span>' + displayName[0].toUpperCase() + '</span>';
                avatarEl.style.background = getAvatarGradient(displayName);
            }

            nameEl.textContent = isBlocked ? (window.i18n?.t('blockedAccount') || 'Заблокированный аккаунт') : (userData.name || window.i18n?.t('user') || 'Пользователь');
            usernameEl.textContent = isBlocked ? '' : ('@' + (userData.username || 'unknown'));
            statusEl.textContent = isBlocked ? (window.i18n?.t('accountBlocked') || 'Аккаунт заблокирован') : (userData.online ? (window.i18n?.t('online') || 'онлайн') : (userData.isBot ? (window.i18n?.t('bot') || 'бот') : (window.i18n?.t('lastSeenRecently') || 'был(а) недавно')));
            statusEl.style.color = isBlocked ? '#FF4B4B' : (userData.isBot ? 'var(--accent-color)' : (userData.online ? 'var(--success-color)' : 'var(--text-muted)'));
            
            // Описание (только если есть)
            if (bioLine) {
                bioLine.textContent = userData.bio || '';
                bioLine.style.display = userData.bio ? 'block' : 'none';
            }
            // Совместимость со старым кодом
            if (bioEl) {
                if (userData.bio) {
                    bioEl.innerHTML = escapeHtml(userData.bio);
                    bioEl.style.display = 'block';
                } else {
                    bioEl.style.display = 'none';
                }
            }

            // Кнопка чата — только для других пользователей (не себя, не ботов, не заблокированных)
            if (chatBtn && userData.id && userData.id !== user.id && !userData.isBot && !isBlocked) {
                chatBtn.style.display = 'flex';
                // Проверяем есть ли уже чат с этим пользователем
                const existingChat = allChats.find(c => {
                    const cu = chatUsers[c.id];
                    return cu && cu.id === userData.id;
                });
            chatBtn.querySelector('span').textContent = existingChat ? (window.i18n?.t('goToChat') || 'Перейти в чат') : (window.i18n?.t('startChat') || 'Начать переписку');
                chatBtn.onclick = () => profileStartChat(userData.id, userData.name || userData.username, existingChat);
            } else if (chatBtn) {
                chatBtn.style.display = 'none';
            }

            // Кнопка копирования юзернейма — скрываем для заблокированных
            const copyBtn = document.querySelector('.profile-copy-btn');
            if (copyBtn) {
                copyBtn.style.display = isBlocked ? 'none' : 'flex';
            }

            // Кнопки действий для разработчиков — при просмотре активных жалоб или если пользователь замучен/забанен
            const adminActions = document.getElementById('profileAdminActions');
            const isDevUser = ['adm1','admin','admin1','qzlfee'].includes((user.username||'').toLowerCase());
            const isFromActiveReport = userData.fromReport && userData.reportStatus !== 'resolved';
            const isMuted = userData.isMuted || false;

            if (adminActions && isDevUser && userData.id && userData.id !== user.id && (isFromActiveReport || isMuted || isBlocked)) {
                adminActions.style.display = 'flex';

                // Показываем/скрываем кнопки в зависимости от статуса
                const muteBtn = document.getElementById('muteBtn');
                const unmuteBtn = document.getElementById('unmuteBtn');
                const blockBtn = document.getElementById('blockBtn');
                const unblockBtn = document.getElementById('unblockBtn');

                if (muteBtn && unmuteBtn) {
                    muteBtn.style.display = isMuted ? 'none' : 'flex';
                    unmuteBtn.style.display = isMuted ? 'flex' : 'none';
                }
                if (blockBtn && unblockBtn) {
                    blockBtn.style.display = isBlocked ? 'none' : 'flex';
                    unblockBtn.style.display = isBlocked ? 'flex' : 'none';
                }
            } else if (adminActions) {
                adminActions.style.display = 'none';
            }

            // Hide the Report button for bots
            const profileMenu = document.getElementById('profileMenu');
            if (profileMenu) {
                const reportBtn = Array.from(profileMenu.querySelectorAll('.profile-menu-item')).find(btn => btn.getAttribute('onclick') === 'reportUser()');
                if (reportBtn) {
                    if (userData.username === 'craneapp_bot' || userData.is_bot) {
                        reportBtn.style.display = 'none';
                    } else {
                        reportBtn.style.display = 'flex';
                    }
                }
            }
            
            // Закрываем меню если открыто
            const menu = document.getElementById('profileMenu');
            if (menu) menu.classList.remove('active');
            
            // Сохраняем текущего пользователя профиля
            currentProfileUser = userData;
            
            // Загружаем настройку уведомлений
            const notifications = JSON.parse(localStorage.getItem('chatNotifications') || '{}');
            document.getElementById('profileNotifications').checked = notifications[userData.id] !== false;
            
            // Загружаем данные для табов
            loadProfileMedia(userData.id);
            loadProfileFiles(userData.id);
            loadProfileLinks(userData.id);
            loadProfileGroups(userData.id);
            
            // Показываем первый таб
            switchProfileTab('media');
            
            document.body.style.overflow = 'hidden';
            document.getElementById('userProfileModal').classList.add('active');
        }

        async function profileStartChat(userId, name, existingChat) {
            closeUserProfileModal();
            if (existingChat) {
                openChat(existingChat.id, existingChat.name);
                return;
            }
            try {
                const res = await fetch('/api/v1/chats/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ type: 'private', participants: [userId] })
                });
                const data = await res.json();
                if (data.chatId) {
                    await loadChats();
                    openChat(data.chatId, name);
                }
            } catch (e) {
                showToast('error', 'Ошибка', '❌');
            }
        }

        function closeUserProfileModal() {
            document.body.style.overflow = '';
            document.getElementById('userProfileModal').classList.remove('active');
        }

        function openChatUserProfile() {
            if (!activeChat) return;
            
            if (activeChat.type === 'group' || activeChat.type === 'channel') {
                openGroupInfoModal(activeChat.id);
                return;
            }

            const chatUser = chatUsers[activeChat.id];
            if (chatUser) {
                openUserProfileModal({
                    id: chatUser.id,
                    name: chatUser.name,
                    username: chatUser.username,
                    avatarUrl: chatUser.av,
                    bio: chatUser.bio || '',
                    online: chatUser.isOnline,
                    isBot: chatUser.isBot || false,
                    isBlocked: chatUser.isBlocked || false,
                    isMuted: chatUser.isMuted || false
                });
            } else {
                showToast('info', tr('userDataUnavailable', 'Данные пользователя недоступны'), '⚠️');
            }
        }

        async function openGroupInfoModal(chatId) {
            const chat = allChats.find(c => c.id === chatId);
            if (!chat) return;

            if (chat.type === 'channel' && typeof window.openChannelInfoModal === 'function') {
                return window.openChannelInfoModal(chatId);
            }

            let members = [];
            try {
                const res = await fetch('/api/v1/chats/' + chatId + '/members', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const data = await res.json();
                    members = data.members || [];
                }
            } catch (_) {}

            activeGroupMembers = members;

            document.body.style.overflow = 'hidden';
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            const isRu = (window.i18n?.currentLang || localStorage.getItem('craneapp_language') || 'ru') === 'ru';

            const myMember = members.find(m => m.id === user.id);
            const myRole = myMember ? myMember.role : 'member';
            const isOwner = myRole === 'owner';
            const currentPerms = myMember ? (myMember.permissions || {}) : {};
            const canBan = isOwner || currentPerms.can_ban_users === true || currentPerms.can_ban_users === 'true';
            const canInvite = isOwner || (currentPerms.can_invite_users !== false && currentPerms.can_invite_users !== 'false');

            function pluralRu(count, one, two, five) {
                const n = Math.abs(count) % 100;
                const n1 = n % 10;
                if (n > 10 && n < 20) return five;
                if (n1 > 1 && n1 < 5) return two;
                if (n1 === 1) return one;
                return five;
            }



            const av = chat.avatarUrl && isImage(chat.avatarUrl)
                ? '<img src="' + chat.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                : '<span style="font-size:42px; font-weight:700;">' + (chat.name[0] || '💬') + '</span>';

            const membersHtml = members.map((m, idx) => {
                const mName = m.first_name || m.username || tr('user', 'Пользователь');
                const mAv = m.avatar_url && isImage(m.avatar_url)
                    ? '<img src="' + m.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                    : '<span style="font-size:16px;font-weight:600;">' + mName[0].toUpperCase() + '</span>';
                
                const avatarBg = m.avatar_url && isImage(m.avatar_url) ? 'transparent' : getAvatarGradient(mName);
                
                let roleBadge = '';
                if (m.role === 'owner') {
                    roleBadge = `<span style="font-size:10px; font-weight:600; background:rgba(255,0,127,0.12); color:#FF007F; padding:2px 6px; border-radius:10px; border:1px solid rgba(255,0,127,0.2); font-family:Geologica,sans-serif;">${isRu ? 'создатель' : 'owner'}</span>`;
                } else if (m.role === 'admin') {
                    roleBadge = `<span style="font-size:10px; font-weight:600; background:rgba(0,230,118,0.12); color:#00E676; padding:2px 6px; border-radius:10px; border:1px solid rgba(0,230,118,0.2); font-family:Geologica,sans-serif;">${isRu ? 'админ' : 'admin'}</span>`;
                }

                const lastSeenVal = m.last_seen || m.lastSeen;
                let statusText = '';
                let statusColor = isLight ? '#999999' : '#8a9bb0';
                
                if (m.is_bot) {
                    statusText = isRu ? 'бот' : 'bot';
                } else if (m.is_online) {
                    statusText = isRu ? 'в сети' : 'online';
                    statusColor = '#9b59b6';
                } else if (lastSeenVal) {
                    const lastSeenDate = new Date(lastSeenVal);
                    const now = new Date();
                    const diffMs = now - lastSeenDate;
                    const diffMins = Math.floor(diffMs / 60000);
                    const diffHours = Math.floor(diffMins / 60);
                    const diffDays = Math.floor(diffHours / 24);
                    
                    if (diffMins < 1) {
                        statusText = isRu ? 'был(а) только что' : 'last seen just now';
                    } else if (diffMins < 60) {
                        statusText = isRu 
                            ? `был(а) ${diffMins} ${pluralRu(diffMins, 'минуту', 'минуты', 'минут')} назад`
                            : `last seen ${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
                    } else if (diffHours < 24) {
                        statusText = isRu
                            ? `был(а) ${diffHours} ${pluralRu(diffHours, 'час', 'часа', 'часов')} назад`
                            : `last seen ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
                    } else if (diffDays < 7) {
                        statusText = isRu
                            ? `был(а) ${diffDays} ${pluralRu(diffDays, 'день', 'дня', 'дней')} назад`
                            : `last seen ${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
                    } else {
                        statusText = isRu
                            ? `был(а) в сети ${lastSeenDate.toLocaleDateString('ru-RU')}`
                            : `last seen on ${lastSeenDate.toLocaleDateString('en-US')}`;
                    }
                } else {
                    statusText = isRu ? 'был(а) недавно' : 'last seen recently';
                }

                const isMe = m.id === user.id;
                const isBot = m.is_bot;
                const clickable = !isMe && !isBot;
                const clickAttr = clickable
                    ? `onclick="closeGroupInfoAndOpenProfile('${m.id}','${mName}','${m.username || ''}','${m.avatar_url || ''}',${!!m.is_online})"`
                    : '';
                
                let gearIcon = '';
                if (!isMe && !isBot) {
                    const canModThis = isOwner || (myRole === 'admin' && canBan && m.role === 'member');
                    if (canModThis) {
                        gearIcon = `<button onclick="event.stopPropagation(); showMemberActionsMenu(${idx})" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; padding:6px; font-size:16px; display:flex; align-items:center; justify-content:center; border-radius:50%; width:28px; height:28px; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='transparent'">⚙️</button>`;
                    }
                }

                return `
                <div style="display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid ${isLight ? '#e5e6e7' : '#24313f'}; cursor:${clickable ? 'pointer' : 'default'}; transition:background 0.15s;" ${clickAttr} onmouseover="this.style.background='${isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.03)'}'" onmouseout="this.style.background='transparent'">
                    <div style="width:40px; height:40px; border-radius:50%; background:${avatarBg}; display:flex; align-items:center; justify-content:center; color:#fff; flex-shrink:0; overflow:hidden;">${mAv}</div>
                    <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:1px;">
                        <span style="font-size:14.5px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family:Geologica,sans-serif;">${mName}</span>
                        <span style="font-size:12.5px; color:${statusColor}; font-family:Geologica,sans-serif;">${statusText}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        ${roleBadge}
                        ${gearIcon}
                    </div>
                </div>`;
            }).join('');

            let modal = document.getElementById('groupInfoModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'groupInfoModal';
                modal.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.6);display:flex;align-items:stretch;justify-content:flex-end;backdrop-filter:blur(4px);';
                modal.onclick = e => { 
                    if (e.target === modal) {
                        modal.remove();
                        document.body.style.overflow = '';
                    }
                };
                document.body.appendChild(modal);
            }

            const mutedChats = JSON.parse(localStorage.getItem('craneapp_muted_chats') || '[]');
            const isMuted = mutedChats.includes(chatId);
            const muteIcon = isMuted ? `<span style="font-size:22px;">🔇</span>` : `<span style="font-size:22px;">🔊</span>`;
            const muteText = isMuted ? (isRu ? 'Вкл. звук' : 'Unmute') : (isRu ? 'Без звука' : 'Mute');

            const leaveIcon = isOwner
                ? `<span style="font-size:22px;">🗑️</span>`
                : `<span style="font-size:22px;">🚪</span>`;

            const moreIcon = `<span style="font-size:22px;">⚙️</span>`;

            const dropdownBg = isLight ? '#ffffff' : '#182533';
            const dropdownHover = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
            const dropdownBorder = isLight ? '#e5e6e7' : '#24313f';

            const bansBtnHtml = canBan
                ? `<div onclick="openBannedUsersModal()" style="display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; color:var(--text-primary); cursor:pointer; transition:background 0.2s; font-family:Geologica,sans-serif;" onmouseover="this.style.background='${dropdownHover}'" onmouseout="this.style.background='transparent'">
                      <span style="font-size:16px;">🚫</span>
                      <span>${isRu ? 'Забаненные' : 'Banned Users'}</span>
                   </div>`
                : '';
            const inviteLinksBtnHtml = (isOwner || (myRole === 'admin' && canInvite))
                ? `<div onclick="openInviteLinksModal()" style="display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; color:var(--text-primary); cursor:pointer; transition:background 0.2s; font-family:Geologica,sans-serif;" onmouseover="this.style.background='${dropdownHover}'" onmouseout="this.style.background='transparent'">
                      <span style="font-size:16px;">🔗</span>
                      <span>${isRu ? 'Ссылки' : 'Invite Links'}</span>
                   </div>`
                : '';
            const joinRequestsBtnHtml = (isOwner || myRole === 'admin')
                ? `<div onclick="openJoinRequestsModal()" style="display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; color:var(--text-primary); cursor:pointer; transition:background 0.2s; font-family:Geologica,sans-serif;" onmouseover="this.style.background='${dropdownHover}'" onmouseout="this.style.background='transparent'">
                      <span style="font-size:16px;">📝</span>
                      <span>${isRu ? 'Заявки' : 'Join Requests'}</span>
                   </div>`
                : '';
            const topicsToggleBtnHtml = (isOwner || myRole === 'admin')
                ? (chat.isSupergroup 
                    ? `<div style="display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; color:#00E676; opacity:0.8; font-family:Geologica,sans-serif;">
                          <span style="font-size:16px;">✨</span>
                          <span>${isRu ? 'Темы активны' : 'Topics Active'}</span>
                       </div>`
                    : `<div onclick="upgradeToSupergroup()" style="display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; color:var(--text-primary); cursor:pointer; transition:background 0.2s; font-family:Geologica,sans-serif;" onmouseover="this.style.background='${dropdownHover}'" onmouseout="this.style.background='transparent'">
                          <span style="font-size:16px;">📁</span>
                          <span>${isRu ? 'Включить темы' : 'Enable Topics'}</span>
                       </div>`)
                : '';
            const reportOption = `<div onclick="showToast('info', '${isRu ? 'Жалоба отправлена модераторам' : 'Report sent to moderators'}', '⚠️')" style="display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; color:#FF4B4B; cursor:pointer; transition:background 0.2s; font-family:Geologica,sans-serif;" onmouseover="this.style.background='${dropdownHover}'" onmouseout="this.style.background='transparent'">
                <span style="font-size:16px;">⚠️</span>
                <span>${isRu ? 'Пожаловаться' : 'Report'}</span>
            </div>`;

            // Shared Media calculations
            const msgs = Object.values(messagesData).filter(m => String(m.chatId) === String(chatId) || String(m.chat_id) === String(chatId));
            const photosCount = msgs.filter(m => m.type === 'image' || m.type === 'photo').length;
            const videosCount = msgs.filter(m => m.type === 'video').length;
            const filesCount = msgs.filter(m => m.type === 'file').length;
            const audioCount = msgs.filter(m => m.type === 'audio').length;
            const voiceCount = msgs.filter(m => m.type === 'voice').length;
            const gifCount = msgs.filter(m => m.type === 'gif').length;
            const linksCount = msgs.filter(m => m.type === 'text' && /(https?:\/\/[^\s]+)/gi.test(m.content || '')).length;
            const pollsCount = 0;

            const finalPhotos = photosCount;
            const finalVideos = videosCount;
            const finalFiles = filesCount;
            const finalAudio = audioCount;
            const finalLinks = linksCount;
            const finalPolls = pollsCount;
            const finalVoices = voiceCount;
            const finalGifs = gifCount;

            function renderMediaRow(icon, text, onClick) {
                return `
                <div onclick="${onClick}" style="display:flex; align-items:center; gap:16px; padding:10px 20px; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='${isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)'}'" onmouseout="this.style.background='transparent'">
                    <div style="color:#5288c1; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon}</div>
                    <span style="font-size:14px; color:var(--text-primary); font-family:Geologica,sans-serif;">${text}</span>
                </div>`;
            }

            let mediaSectionHtml = '';
            if (finalPhotos > 0 || finalVideos > 0 || finalFiles > 0 || finalAudio > 0 || finalLinks > 0 || finalPolls > 0 || finalVoices > 0 || finalGifs > 0) {
                mediaSectionHtml += `<div style="display:flex; flex-direction:column; padding:8px 0; border-top: 1px solid ${isLight ? '#e5e6e7' : '#24313f'};">`;
                
                if (finalPhotos > 0) {
                    const text = isRu ? `${finalPhotos} ${pluralRu(finalPhotos, 'фотография', 'фотографии', 'фотографий')}` : `${finalPhotos} ${finalPhotos === 1 ? 'photo' : 'photos'}`;
                    mediaSectionHtml += renderMediaRow('🖼️', text, `openMediaSection('${chatId}', 'image')`);
                }
                if (finalVideos > 0) {
                    const text = isRu ? `${finalVideos} ${pluralRu(finalVideos, 'видео', 'видео', 'видео')}` : `${finalVideos} ${finalVideos === 1 ? 'video' : 'videos'}`;
                    mediaSectionHtml += renderMediaRow('🎥', text, `openMediaSection('${chatId}', 'video')`);
                }
                if (finalFiles > 0) {
                    const text = isRu ? `${finalFiles} ${pluralRu(finalFiles, 'файл', 'файла', 'файлов')}` : `${finalFiles} ${finalFiles === 1 ? 'file' : 'files'}`;
                    mediaSectionHtml += renderMediaRow('📎', text, `openMediaSection('${chatId}', 'file')`);
                }
                if (finalAudio > 0) {
                    const text = isRu ? `${finalAudio} ${pluralRu(finalAudio, 'аудиофайл', 'аудиофайла', 'аудиофайлов')}` : `${finalAudio} ${finalAudio === 1 ? 'audio file' : 'audio files'}`;
                    mediaSectionHtml += renderMediaRow('🎵', text, `openMediaSection('${chatId}', 'audio')`);
                }
                if (finalLinks > 0) {
                    const text = isRu ? `${finalLinks} ${pluralRu(finalLinks, 'ссылка', 'ссылки', 'ссылок')}` : `${finalLinks} ${finalLinks === 1 ? 'link' : 'links'}`;
                    mediaSectionHtml += renderMediaRow('🔗', text, `openMediaSection('${chatId}', 'links')`);
                }
                if (finalPolls > 0) {
                    const text = isRu ? `${finalPolls} ${pluralRu(finalPolls, 'опрос', 'опроса', 'опросов')}` : `${finalPolls} ${finalPolls === 1 ? 'poll' : 'polls'}`;
                    mediaSectionHtml += renderMediaRow('📊', text, `openMediaSection('${chatId}', 'poll')`);
                }
                if (finalVoices > 0) {
                    const text = isRu ? `${finalVoices} ${pluralRu(finalVoices, 'голосовое сообщение', 'голосовых сообщения', 'голосовых сообщений')}` : `${finalVoices} ${finalVoices === 1 ? 'voice message' : 'voice messages'}`;
                    mediaSectionHtml += renderMediaRow('🎤', text, `openMediaSection('${chatId}', 'voice')`);
                }
                if (finalGifs > 0) {
                    const text = isRu ? `${finalGifs} GIF` : `${finalGifs} ${finalGifs === 1 ? 'GIF' : 'GIFs'}`;
                    mediaSectionHtml += renderMediaRow('🎞️', text, `openMediaSection('${chatId}', 'gif')`);
                }
                
                mediaSectionHtml += `</div>`;
            }

            modal.innerHTML = `
                <div style="background:${isLight ? '#f5f6f7' : 'var(--bg-secondary)'}; color:var(--text-primary); border-left:1px solid var(--border-color); width:100%; max-width:420px; height:100%; overflow-y:auto; animation:slideLeft 0.25s ease-out; display:flex; flex-direction:column; box-shadow:-8px 0 24px rgba(0,0,0,0.5);">
                    <!-- Close button row -->
                    <div style="display:flex; align-items:center; justify-content:flex-end; padding:12px 16px 0;">
                        <button onclick="document.getElementById('groupInfoModal').remove(); document.body.style.overflow='';" style="background:transparent; border:none; color:var(--text-secondary); width:32px; height:32px; border-radius:50%; cursor:pointer; font-size:24px; display:flex; align-items:center; justify-content:center; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='transparent'">×</button>
                    </div>
                    
                    <!-- Group Details -->
                    <div style="display:flex; flex-direction:column; align-items:center; padding:0 24px 20px; text-align:center;">
                        <div style="width:100px; height:100px; border-radius:50%; background:${getAvatarGradient(chat.name)}; display:flex; align-items:center; justify-content:center; color:#fff; font-size:42px; overflow:hidden; margin-bottom:14px; box-shadow:0 8px 16px rgba(0,0,0,0.2);">${av}</div>
                        <div style="font-size:20px; font-weight:700; color:var(--text-primary); margin-bottom:4px; word-break:break-word; line-height:1.3; font-family:Geologica,sans-serif;">${chat.name}</div>
                        <div style="font-size:13.5px; color:var(--text-muted); font-family:Geologica,sans-serif;">${members.length} ${isRu ? pluralRu(members.length, 'участник', 'участника', 'участников') : (members.length === 1 ? 'member' : 'members')}</div>
                    </div>

                    <!-- Quick Actions Row -->
                    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; width:100%; padding:0 20px 16px;">
                        <!-- Mute -->
                        <div onclick="toggleGroupMute('${chatId}')" class="group-info-action-btn" style="background:${isLight ? '#ffffff' : 'var(--bg-tertiary)'}; border:${isLight ? '1px solid #e5e6e7' : 'none'}; border-radius:10px; padding:12px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='${isLight ? '#f0f0f2' : '#2a2a2a'}'" onmouseout="this.style.background='${isLight ? '#ffffff' : 'var(--bg-tertiary)'}'">
                            ${muteIcon}
                            <span style="font-size:12px; color:#9b59b6; font-weight:600; font-family:Geologica,sans-serif;">${muteText}</span>
                        </div>
                        <!-- Leave / Delete -->
                        <div onclick="handleGroupLeaveOrDelete('${chatId}', ${isOwner})" class="group-info-action-btn" style="background:${isLight ? '#ffffff' : 'var(--bg-tertiary)'}; border:${isLight ? '1px solid #e5e6e7' : 'none'}; border-radius:10px; padding:12px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='${isLight ? '#f0f0f2' : '#2a2a2a'}'" onmouseout="this.style.background='${isLight ? '#ffffff' : 'var(--bg-tertiary)'}'">
                            ${leaveIcon}
                            <span style="font-size:12px; color:${isOwner ? '#FF4B4B' : '#9b59b6'}; font-weight:600; font-family:Geologica,sans-serif;">${isOwner ? (isRu ? 'Удалить' : 'Delete') : (isRu ? 'Покинуть' : 'Leave')}</span>
                        </div>
                        <!-- More -->
                        <div id="groupInfoMoreBtn" onclick="toggleGroupMoreMenu(event)" class="group-info-action-btn" style="background:${isLight ? '#ffffff' : 'var(--bg-tertiary)'}; border:${isLight ? '1px solid #e5e6e7' : 'none'}; border-radius:10px; padding:12px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; position:relative; transition:background 0.2s;" onmouseover="this.style.background='${isLight ? '#f0f0f2' : '#2a2a2a'}'" onmouseout="this.style.background='${isLight ? '#ffffff' : 'var(--bg-tertiary)'}'">
                            ${moreIcon}
                            <span style="font-size:12px; color:#9b59b6; font-weight:600; font-family:Geologica,sans-serif;">${isRu ? 'Ещё' : 'More'}</span>
                            
                            <!-- Dropdown Menu -->
                            <div id="groupInfoMoreMenu" style="display:none; position:absolute; top:calc(100% + 6px); right:0; background:${dropdownBg}; border:1px solid ${dropdownBorder}; border-radius:10px; width:180px; box-shadow:0 8px 16px rgba(0,0,0,0.3); z-index:10000; overflow:hidden; text-align:left;">
                                ${bansBtnHtml}
                                ${inviteLinksBtnHtml}
                                ${joinRequestsBtnHtml}
                                ${topicsToggleBtnHtml}
                                ${reportOption}
                            </div>
                        </div>
                    </div>

                    <!-- Shared Media Section -->
                    ${mediaSectionHtml}

                    <!-- Divider -->
                    <div style="height:8px; background:${isLight ? '#e5e6e7' : 'var(--bg-primary)'}; flex-shrink:0;"></div>

                    <!-- Participants Section Header -->
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px 8px;">
                        <span style="font-size:13px; font-weight:600; color:#9b59b6; text-transform:uppercase; letter-spacing:0.05em; font-family:Geologica,sans-serif;">
                            ${members.length} ${isRu ? pluralRu(members.length, 'участник', 'участника', 'участников') : (members.length === 1 ? 'member' : 'members')}
                        </span>
                        ${canInvite ? `
                        <button onclick="openAddGroupMemberModal('${chatId}')" style="background:transparent; border:none; color:#9b59b6; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:4px; border-radius:50%; width:32px; height:32px; transition:background 0.2s;" onmouseover="this.style.background='rgba(155,89,182,0.1)'" onmouseout="this.style.background='transparent'">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                <circle cx="8.5" cy="7" r="4"/>
                                <line x1="20" y1="8" x2="20" y2="14"/>
                                <line x1="17" y1="11" x2="23" y2="11"/>
                            </svg>
                        </button>` : ''}
                    </div>

                    <!-- Participants List -->
                    <div style="flex:1; display:flex; flex-direction:column; overflow-y:auto; padding-bottom:24px;">
                        ${membersHtml || '<div style="padding:16px;color:var(--text-muted);text-align:center;font-family:Geologica,sans-serif;">' + tr('noMembers', 'Нет участников') + '</div>'}
                    </div>
                </div>`;
            modal.style.display = 'flex';
        }

        async function handleGroupLeaveOrDelete(chatId, isOwner) {
            const title = isOwner ? 'Удалить группу?' : 'Выйти из группы?';
            const text = isOwner 
                ? 'Группа и все сообщения будут удалены для всех участников.' 
                : 'Вы больше не будете получать сообщения из этой группы.';
            
            document.getElementById('confirmTitle').textContent = title;
            document.getElementById('confirmText').textContent = text;
            document.getElementById('confirmBtn').onclick = async function() {
                try {
                    const res = await fetch('/api/v1/chats/' + chatId, {
                        method: 'DELETE',
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    const data = await res.json();
                    if (res.ok) {
                        closeConfirmModal();
                        const modal = document.getElementById('groupInfoModal');
                        if (modal) modal.remove();
                        closeChat();
                        loadChats();
                        showToast('success', isOwner ? 'Группа удалена' : 'Вы вышли из группы', '✓');
                    } else {
                        showToast('error', data.error || 'Ошибка', '❌');
                    }
                } catch (err) {
                    showToast('error', 'Ошибка сети', '❌');
                }
            };
            document.getElementById('confirmModal').classList.add('active');
        }

        function openMediaSection(chatId, mediaType) {
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            const isRu = (window.i18n?.currentLang || localStorage.getItem('craneapp_language') || 'ru') === 'ru';
            const msgs = Object.values(messagesData).filter(m => String(m.chatId) === String(chatId) || String(m.chat_id) === String(chatId));

            const typeLabels = {
                image: isRu ? 'Фотографии' : 'Photos',
                video: isRu ? 'Видео' : 'Videos',
                file: isRu ? 'Файлы' : 'Files',
                audio: isRu ? 'Аудио' : 'Audio',
                voice: isRu ? 'Голосовые' : 'Voice',
                gif: 'GIF',
                links: isRu ? 'Ссылки' : 'Links',
                poll: isRu ? 'Опросы' : 'Polls'
            };

            let filtered = [];
            if (mediaType === 'links') {
                filtered = msgs.filter(m => m.type === 'text' && /(https?:\/\/[^\s]+)/gi.test(m.content || ''));
            } else if (mediaType === 'image') {
                filtered = msgs.filter(m => m.type === 'image' || m.type === 'photo');
            } else {
                filtered = msgs.filter(m => m.type === mediaType);
            }

            let contentHtml = '';
            if (filtered.length === 0) {
                contentHtml = `<div style="padding:40px 20px; text-align:center; color:var(--text-muted); font-family:Geologica,sans-serif;">${isRu ? 'Нет контента' : 'No content'}</div>`;
            } else if (mediaType === 'image' || mediaType === 'gif') {
                contentHtml = `<div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:2px; padding:4px;">`;
                filtered.forEach(m => {
                    const src = m.mediaUrl || m.fileUrl || m.content || '';
                    if (src) {
                        contentHtml += `<div onclick="openMediaPreview('${src}','image')" style="aspect-ratio:1; cursor:pointer; overflow:hidden; border-radius:4px;">
                            <img src="${src}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.style.background='var(--bg-tertiary)'; this.remove();">
                        </div>`;
                    }
                });
                contentHtml += `</div>`;
            } else if (mediaType === 'video') {
                contentHtml = `<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:4px; padding:8px;">`;
                filtered.forEach(m => {
                    const src = m.mediaUrl || m.fileUrl || m.content || '';
                    if (src) {
                        contentHtml += `<div onclick="openMediaPreview('${src}','video')" style="aspect-ratio:16/9; cursor:pointer; overflow:hidden; border-radius:6px; background:var(--bg-tertiary); display:flex; align-items:center; justify-content:center; position:relative;">
                            <span style="font-size:32px; position:absolute; z-index:1;">▶️</span>
                            <video src="${src}" style="width:100%; height:100%; object-fit:cover;" muted></video>
                        </div>`;
                    }
                });
                contentHtml += `</div>`;
            } else if (mediaType === 'links') {
                contentHtml = `<div style="display:flex; flex-direction:column; padding:8px 0;">`;
                filtered.forEach(m => {
                    const urlMatch = (m.content || '').match(/(https?:\/\/[^\s]+)/gi);
                    if (urlMatch) {
                        urlMatch.forEach(url => {
                            contentHtml += `<a href="${url}" target="_blank" rel="noopener" style="display:flex; align-items:center; gap:12px; padding:10px 16px; text-decoration:none; color:var(--text-primary); transition:background 0.2s; font-family:Geologica,sans-serif;" onmouseover="this.style.background='${isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'}'" onmouseout="this.style.background='transparent'">
                                <span style="font-size:18px;">🔗</span>
                                <span style="font-size:13px; color:#9b59b6; word-break:break-all;">${url}</span>
                            </a>`;
                        });
                    }
                });
                contentHtml += `</div>`;
            } else {
                contentHtml = `<div style="display:flex; flex-direction:column; padding:8px 0;">`;
                filtered.forEach(m => {
                    const name = m.fileName || m.content || (isRu ? 'Файл' : 'File');
                    const src = m.mediaUrl || m.fileUrl || '';
                    const emoji = mediaType === 'audio' ? '🎵' : mediaType === 'voice' ? '🎤' : '📄';
                    contentHtml += `<div onclick="${src ? `window.open('${src}','_blank')` : ''}" style="display:flex; align-items:center; gap:12px; padding:10px 16px; cursor:${src ? 'pointer' : 'default'}; transition:background 0.2s; font-family:Geologica,sans-serif;" onmouseover="this.style.background='${isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'}'" onmouseout="this.style.background='transparent'">
                        <span style="font-size:18px;">${emoji}</span>
                        <span style="font-size:13px; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>
                    </div>`;
                });
                contentHtml += `</div>`;
            }

            let overlay = document.getElementById('mediaSectionOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'mediaSectionOverlay';
                overlay.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(0,0,0,0.7);display:flex;align-items:stretch;justify-content:flex-end;backdrop-filter:blur(4px);';
                overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
                document.body.appendChild(overlay);
            }

            overlay.innerHTML = `
                <div style="background:${isLight ? '#f5f6f7' : 'var(--bg-secondary)'}; color:var(--text-primary); border-left:1px solid var(--border-color); width:100%; max-width:420px; height:100%; overflow-y:auto; animation:slideLeft 0.25s ease-out; display:flex; flex-direction:column; box-shadow:-8px 0 24px rgba(0,0,0,0.5);">
                    <div style="display:flex; align-items:center; gap:12px; padding:14px 16px; border-bottom:1px solid ${isLight ? '#e5e6e7' : 'var(--border-color)'}; flex-shrink:0;">
                        <button onclick="document.getElementById('mediaSectionOverlay').remove()" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; font-size:20px; padding:4px 8px; border-radius:6px; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='transparent'">←</button>
                        <span style="font-size:17px; font-weight:700; color:var(--text-primary); font-family:Geologica,sans-serif;">${typeLabels[mediaType] || mediaType}</span>
                        <span style="font-size:13px; color:#9b59b6; font-weight:600; font-family:Geologica,sans-serif;">${filtered.length}</span>
                    </div>
                    <div style="flex:1; overflow-y:auto;">
                        ${contentHtml}
                    </div>
                </div>`;
            overlay.style.display = 'flex';
        }

        async function confirmKickGroupMember(chatId, userId, name) {
            document.getElementById('confirmTitle').textContent = 'Исключить участника?';
            document.getElementById('confirmText').textContent = `Вы действительно хотите исключить ${name} из группы?`;
            document.getElementById('confirmBtn').onclick = async function() {
                try {
                    const res = await fetch(`/api/v1/chats/${chatId}/members/${userId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    const data = await res.json();
                    if (res.ok) {
                        closeConfirmModal();
                        showToast('success', `${name} исключен(а)`, '✓');
                        openGroupInfoModal(chatId);
                    } else {
                        showToast('error', data.error || 'Ошибка удаления', '❌');
                    }
                } catch (err) {
                    showToast('error', 'Ошибка сети', '❌');
                }
            };
            document.getElementById('confirmModal').classList.add('active');
        }

        function openAddGroupMemberModal(chatId) {
            let addModal = document.getElementById('addGroupMemberModal');
            if (!addModal) {
                addModal = document.createElement('div');
                addModal.id = 'addGroupMemberModal';
                addModal.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
                addModal.onclick = e => { if (e.target === addModal) closeAddGroupMemberModal(); };
                document.body.appendChild(addModal);
            }

            addModal.innerHTML = `
                <div style="background:var(--bg-secondary,#111);border-radius:20px;width:90%;max-width:400px;padding:20px;border:1px solid rgba(255,255,255,0.08);animation:scaleUp 0.2s ease-out;color:var(--text-primary,#fff);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                        <span style="font-size:17px;font-weight:700;letter-spacing:-0.01em;">Добавить участника</span>
                        <button onclick="closeAddGroupMemberModal()" style="background:transparent;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;">×</button>
                    </div>
                    <input type="text" id="addGroupMemberInput" placeholder="Введите имя или @username" style="width:100%;height:42px;border-radius:10px;border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-primary);padding:0 12px;font-size:14px;outline:none;margin-bottom:12px;" oninput="searchUsersForAddGroup('${chatId}', this.value)">
                    <div id="addGroupMemberList" style="max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
                        <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Введите от 2 символов для поиска</div>
                    </div>
                </div>`;
            addModal.style.display = 'flex';
            setTimeout(() => document.getElementById('addGroupMemberInput').focus(), 50);
        }

        function closeAddGroupMemberModal() {
            const addModal = document.getElementById('addGroupMemberModal');
            if (addModal) addModal.remove();
        }

        let addGroupSearchTimeout = null;
        function searchUsersForAddGroup(chatId, queryStr) {
            if (addGroupSearchTimeout) clearTimeout(addGroupSearchTimeout);
            const list = document.getElementById('addGroupMemberList');
            if (!list) return;

            const q = queryStr.trim().replace('@', '');
            if (q.length < 2) {
                list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Введите от 2 символов для поиска</div>';
                return;
            }

            list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Поиск...</div>';

            addGroupSearchTimeout = setTimeout(async () => {
                try {
                    const res = await fetch('/api/v1/users/search?q=' + encodeURIComponent(q), {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    if (!res.ok) { list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Ошибка поиска</div>'; return; }
                    const data = await res.json();
                    const users = (data.users || []).filter(u => u.id !== user.id);
                    if (!users.length) {
                        list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Пользователи не найдены</div>';
                        return;
                    }
                    list.innerHTML = users.map(u => {
                        const name = ((u.firstName||'') + (u.lastName ? ' '+u.lastName : '')).trim() || u.username;
                        const av = u.avatarUrl ? `<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : name[0].toUpperCase();
                        return `<div onclick="submitAddGroupMember('${chatId}', '${u.id}', '${name.replace(/'/g,"\\'")}')" style="display:flex;align-items:center;gap:12px;padding:8px 10px;cursor:pointer;border-radius:10px;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='transparent'">
                            <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#FF007F,#9D00FF);display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;flex-shrink:0;overflow:hidden;">${av}</div>
                            <div style="flex:1;min-width:0;"><div style="font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div><div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">@${u.username}</div></div>
                        </div>`;
                    }).join('');
                } catch (e) {
                    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Ошибка поиска</div>';
                }
            }, 300);
        }

        async function submitAddGroupMember(chatId, targetUserId, name) {
            try {
                const res = await fetch(`/api/v1/chats/${chatId}/members`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ userId: targetUserId })
                });
                const data = await res.json();
                if (res.ok) {
                    showToast('success', `${name} добавлен(а) в группу`, '✓');
                    closeAddGroupMemberModal();
                    openGroupInfoModal(chatId); // обновить модал группы
                } else {
                    showToast('error', data.error || 'Ошибка добавления', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        // Дополнительные хэндлеры для меню группы в стиле Telegram
        function toggleGroupMute(chatId) {
            const isRu = (window.i18n?.currentLang || localStorage.getItem('craneapp_language') || 'ru') === 'ru';
            const mutedChats = JSON.parse(localStorage.getItem('craneapp_muted_chats') || '[]');
            const idx = mutedChats.indexOf(chatId);
            if (idx > -1) {
                mutedChats.splice(idx, 1);
                showToast('success', isRu ? 'Звук включен' : 'Sound enabled', '🔔');
            } else {
                mutedChats.push(chatId);
                showToast('success', isRu ? 'Звук выключен' : 'Sound muted', '🔇');
            }
            localStorage.setItem('craneapp_muted_chats', JSON.stringify(mutedChats));
            openGroupInfoModal(chatId); // перерендерить инфо
        }

        function toggleGroupMoreMenu(event) {
            event.stopPropagation();
            const menu = document.getElementById('groupInfoMoreMenu');
            if (!menu) return;
            const isVisible = menu.style.display === 'block';
            menu.style.display = isVisible ? 'none' : 'block';
        }

        // Закрытие выпадающего меню при клике в любое место
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('groupInfoMoreMenu');
            if (menu && menu.style.display === 'block') {
                const btn = document.getElementById('groupInfoMoreBtn');
                if (btn && !btn.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        });

        // Экспортируем функции в глобальную область, так как они вызываются из onclick атрибутов
        window.openGroupInfoModal = openGroupInfoModal;
        window.confirmKickGroupMember = confirmKickGroupMember;
        window.openAddGroupMemberModal = openAddGroupMemberModal;
        window.closeAddGroupMemberModal = closeAddGroupMemberModal;
        window.searchUsersForAddGroup = searchUsersForAddGroup;
        window.submitAddGroupMember = submitAddGroupMember;
        window.handleGroupLeaveOrDelete = handleGroupLeaveOrDelete;
        window.closeGroupInfoAndOpenProfile = closeGroupInfoAndOpenProfile;
        window.toggleGroupMute = toggleGroupMute;
        window.toggleGroupMoreMenu = toggleGroupMoreMenu;

        function closeGroupInfoAndOpenProfile(id, name, username, avatarUrl, isOnline) {
            const modal = document.getElementById('groupInfoModal');
            if (modal) modal.remove();
            openUserProfileModal({ id, name, username, avatarUrl, online: isOnline });
        }

        document.getElementById('userProfileModal').addEventListener('click', function(e) { 
            if (e.target.id === 'userProfileModal') closeUserProfileModal(); 
        });

        // ============================================
        // MEDIA PREVIEW
        // ============================================
        function openMediaPreview(url, type) {
            currentPreviewMediaUrl = url;
            const contentEl = document.getElementById('mediaPreviewContent');
            
            if (type === 'video') {
                contentEl.innerHTML = '<video src="' + url + '" controls autoplay style="max-width:100%;max-height:100%;border-radius:4px;"></video>';
            } else {
                contentEl.innerHTML = '<img src="' + url + '" alt="" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;user-select:none;" draggable="false">';
            }
            
            document.getElementById('mediaPreviewOverlay').classList.add('active');
        }

        function closeMediaPreview(event) {
            if (event && event.target !== document.getElementById('mediaPreviewOverlay')) return;
            const contentEl = document.getElementById('mediaPreviewContent');
            const video = contentEl.querySelector('video');
            if (video) video.pause();
            contentEl.innerHTML = '';
            document.getElementById('mediaPreviewOverlay').classList.remove('active');
            currentPreviewMediaUrl = null;
        }

        function downloadMedia() {
            if (!currentPreviewMediaUrl) return;
            const a = document.createElement('a');
            a.href = currentPreviewMediaUrl;
            a.download = 'media_' + Date.now();
            a.click();
            showToast('success', 'Загрузка началась', '📥');
        }

        function downloadCurrentMedia() {
            document.getElementById('messageContextMenu').classList.remove('active');
            const msg = messagesData[currentMessageId];
            if (!msg || !msg.mediaUrl) return;
            const a = document.createElement('a');
            a.href = msg.mediaUrl;
            a.download = 'photo_' + Date.now();
            a.click();
            showToast('success', tr('downloadStarted', 'Загрузка началась'), '📥');
        }

        async function copyMessagePhoto() {
            document.getElementById('messageContextMenu').classList.remove('active');
            const msg = messagesData[currentMessageId];
            if (!msg || !msg.mediaUrl) return;
            try {
                // Пробуем скопировать в буфер обмена как изображение
                const res = await fetch(msg.mediaUrl);
                const blob = await res.blob();
                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                showToast('success', tr('photoCopied', 'Фото скопировано'), '📋');
            } catch (_) {
                // Fallback — копируем URL
                navigator.clipboard.writeText(msg.mediaUrl).catch(() => {});
                showToast('success', tr('linkCopied', 'Ссылка скопирована'), '📋');
            }
        }

        function copyMediaLink() {
            if (!currentPreviewMediaUrl) return;
            
            if (currentPreviewMediaUrl.startsWith('data:')) {
                showToast('success', tr('mediaCopiedBuffer', 'Медиа сохранено в буфер'), '📋');
            } else {
                navigator.clipboard.writeText(currentPreviewMediaUrl);
                showToast('success', tr('linkCopied', 'Ссылка скопирована'), '📋');
            }
        }

        // ============================================
        // ATTACHMENT PANEL (как в Telegram)
        // ============================================
        function toggleAttachmentPanel() {
            const panel = document.getElementById('attachmentPanel');
            const btn = document.getElementById('mediaBtn');
            
            if (panel.classList.contains('active')) {
                panel.classList.remove('active');
                btn.classList.remove('active');
            } else {
                // Закрываем другие панели
                closeEmojiPicker();
                panel.classList.add('active');
                btn.classList.add('active');
            }
        }

        function closeAttachmentPanel() {
            document.getElementById('attachmentPanel').classList.remove('active');
            document.getElementById('mediaBtn').classList.remove('active');
        }

        function openFilePicker() {
            closeAttachmentPanel();
            document.getElementById('fileInput').click();
        }

        function shareLocation() {
            closeAttachmentPanel();
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        const locationUrl = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
                        const locationText = tr('myLocationMessage', '📍 Моя геопозиция: {url}', { url: locationUrl });
                        document.getElementById('msgInput').textContent = locationText;
                        send();
                    },
                    (err) => showToast('error', tr('geolocationError', 'Не удалось получить геопозицию'), '❌')
                );
            } else {
                showToast('error', tr('geolocationUnsupported', 'Геолокация не поддерживается'), '❌');
            }
        }

        function shareContact() {
            closeAttachmentPanel();
            showToast('info', tr('featureSoon', 'Функция скоро будет доступна'), 'ℹ️');
        }

        const _pollPendingSelections = {};
        const _pollPayloadCache = new Map();

        function updatePollButtonVisibility() {
            const btn = document.getElementById('pollAttachBtn');
            if (!btn) return;
            btn.style.display = (activeChat && activeChat.type === 'group') ? 'flex' : 'none';
        }

        function _resetPollCreatorFields() {
            const list = document.getElementById('pollOptionsList');
            if (!list) return;
            document.getElementById('pollQuestionInput').value = '';
            document.getElementById('pollAnonymous').checked = false;
            document.getElementById('pollMultiple').checked = false;
            list.innerHTML = '';
            addPollOptionField();
            addPollOptionField();
        }

        function addPollOptionField(value) {
            const list = document.getElementById('pollOptionsList');
            if (!list || list.children.length >= 10) return;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;align-items:center;';
            row.innerHTML = '<input type="text" class="poll-option-input" maxlength="100" placeholder="' + tr('pollOptionPlaceholder', 'Вариант ответа') + '" value="' + (value ? String(value).replace(/"/g, '&quot;') : '') + '">'
                + '<button type="button" onclick="removePollOptionField(this)" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:4px;">×</button>';
            list.appendChild(row);
        }

        function removePollOptionField(btn) {
            const list = document.getElementById('pollOptionsList');
            if (!list || list.children.length <= 2) {
                showToast('error', tr('pollMinOptions', 'Минимум 2 варианта'), '❌');
                return;
            }
            btn.parentElement.remove();
        }

        function openPollCreator() {
            if (!activeChat || activeChat.type !== 'group') {
                showToast('error', tr('pollGroupOnly', 'Опросы доступны только в группах'), '❌');
                return;
            }
            closeAttachmentPanel();
            _resetPollCreatorFields();
            document.getElementById('pollModal').classList.add('active');
        }

        function closePollModal() {
            document.getElementById('pollModal').classList.remove('active');
        }

        async function sendPoll() {
            if (!activeChat) return;
            const question = (document.getElementById('pollQuestionInput').value || '').trim();
            const optionInputs = Array.from(document.querySelectorAll('#pollOptionsList .poll-option-input'));
            const options = optionInputs.map(function(inp) { return (inp.value || '').trim(); }).filter(Boolean);
            const isAnonymous = document.getElementById('pollAnonymous').checked;
            const allowMultiple = document.getElementById('pollMultiple').checked;

            if (!question) {
                showToast('error', tr('pollQuestionRequired', 'Введите вопрос'), '❌');
                return;
            }
            if (options.length < 2) {
                showToast('error', tr('pollMinOptions', 'Минимум 2 варианта'), '❌');
                return;
            }

            closePollModal();

            try {
                const res = await fetch('/api/v1/messages/' + activeChat.id, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({
                        type: 'poll',
                        question: question,
                        options: options,
                        isAnonymous: isAnonymous,
                        allowMultiple: allowMultiple
                    })
                });
                const data = await res.json();
                if (!res.ok) {
                    showToast('error', data.error || tr('sendError', 'Ошибка отправки'), '❌');
                    return;
                }
                if (data.message) {
                    addMessage(data.message);
                    markChatAsRead(activeChat.id, { silent: true }).catch(function() {});
                }
            } catch (err) {
                console.error('Send poll error:', err);
                showToast('error', tr('sendError', 'Ошибка отправки'), '❌');
            }
        }

        function _escapePollText(text) {
            return String(text || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function _getPollPendingSelection(messageId) {
            if (!_pollPendingSelections[messageId]) {
                _pollPendingSelections[messageId] = new Set();
            }
            return _pollPendingSelections[messageId];
        }

        const POLL_VOTE_ANIM_MS = 750;
        const _pollVoteAnimLocks = {};

        function _clearPollVoteActivateClasses(messageId) {
            const msgEl = document.querySelector('[data-message-id="' + messageId + '"]');
            if (!msgEl) return;
            msgEl.querySelectorAll('.poll-option.poll-option-vote-activate').forEach(function(optEl) {
                optEl.classList.remove('poll-option-vote-activate');
            });
        }

        function _queuePollUpdateDuringVoteAnimation(messageId, poll) {
            const lock = _pollVoteAnimLocks[messageId];
            if (!lock) return false;
            lock.pendingPoll = poll;
            if (messagesData[messageId]) {
                messagesData[messageId].poll = poll;
            }
            return true;
        }

        function _finishPollVoteAnimation(messageId) {
            const lock = _pollVoteAnimLocks[messageId];
            if (!lock) return;
            delete _pollVoteAnimLocks[messageId];

            if (lock.pendingPoll) {
                refreshPollElement(messageId);
            }

            lock.resolve();
        }

        function _cancelPollVoteAnimation(messageId) {
            const lock = _pollVoteAnimLocks[messageId];
            if (!lock) return;
            delete _pollVoteAnimLocks[messageId];
            _clearPollVoteActivateClasses(messageId);
            lock.resolve();
        }

        function beginPollVoteAnimation(messageId, optionIds) {
            return new Promise(function(resolve) {
                if (!optionIds || !optionIds.length) {
                    resolve();
                    return;
                }

                _pollVoteAnimLocks[messageId] = { resolve: resolve, pendingPoll: null };

                const msgEl = document.querySelector('[data-message-id="' + messageId + '"]');
                const selectedIds = new Set(optionIds.map(String));
                let activated = 0;

                if (msgEl) {
                    msgEl.querySelectorAll('.poll-option').forEach(function(optEl) {
                        if (!selectedIds.has(String(optEl.dataset.optionId))) return;
                        optEl.classList.remove('poll-option-vote-activate');
                        void optEl.offsetWidth;
                        optEl.classList.add('poll-option-vote-activate');
                        activated++;
                    });
                }

                if (!activated) {
                    delete _pollVoteAnimLocks[messageId];
                    resolve();
                    return;
                }

                setTimeout(function() {
                    _finishPollVoteAnimation(messageId);
                }, POLL_VOTE_ANIM_MS);
            });
        }

        async function submitPollVote(messageId, optionIds) {
            if (!optionIds || !optionIds.length) return;

            const animationPromise = beginPollVoteAnimation(messageId, optionIds);

            try {
                const res = await fetch('/api/v1/polls/' + messageId + '/vote', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ optionIds: optionIds })
                });
                const data = await res.json();
                if (!res.ok) {
                    _cancelPollVoteAnimation(messageId);
                    showToast('error', data.error || tr('pollVoteError', 'Не удалось проголосовать'), '❌');
                    return;
                }
                delete _pollPendingSelections[messageId];
                if (data.poll) {
                    _queuePollUpdateDuringVoteAnimation(messageId, data.poll);
                }
                await animationPromise;
                if (data.poll) {
                    const msgEl = document.querySelector('[data-message-id="' + messageId + '"]');
                    if (msgEl && msgEl.querySelector('.poll-option:not(:disabled)')) {
                        updatePollInMessage(messageId, data.poll);
                    }
                }
            } catch (err) {
                console.error('Poll vote error:', err);
                _cancelPollVoteAnimation(messageId);
                showToast('error', tr('pollVoteError', 'Не удалось проголосовать'), '❌');
            }
        }

        function handlePollOptionClick(messageId, optionId, poll) {
            if (poll.hasVoted) return;
            if (poll.allowMultiple) {
                const selected = _getPollPendingSelection(messageId);
                if (selected.has(optionId)) selected.delete(optionId);
                else selected.add(optionId);
                refreshPollElement(messageId);
                return;
            }
            submitPollVote(messageId, [optionId]);
        }

        function submitPendingPollVotes(messageId) {
            const selected = Array.from(_getPollPendingSelection(messageId));
            if (!selected.length) {
                showToast('error', tr('pollSelectOption', 'Выберите вариант'), '❌');
                return;
            }
            submitPollVote(messageId, selected);
        }

        function updatePollInMessage(messageId, poll) {
            if (_queuePollUpdateDuringVoteAnimation(messageId, poll)) return;
            if (messagesData[messageId]) {
                messagesData[messageId].poll = poll;
            }
            refreshPollElement(messageId);
        }

        async function refreshPollFromServer(messageId) {
            if (!messagesData[messageId] || messagesData[messageId].type !== 'poll') return;
            try {
                const res = await fetch('/api/v1/polls/' + messageId, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                if (res.ok && data.poll) {
                    updatePollInMessage(messageId, data.poll);
                }
            } catch (err) {
                console.error('Refresh poll error:', err);
            }
        }

        function refreshPollElement(messageId) {
            const msgEl = document.querySelector('[data-message-id="' + messageId + '"]');
            if (!msgEl) return;
            const msg = messagesData[messageId];
            if (!msg || !msg.poll) return;
            const existing = msgEl.querySelector('.poll-message');
            if (existing) {
                const replacement = createPollElement(messageId, msg.poll);
                existing.replaceWith(replacement);
            }
        }

        function _createPollCheckbox(checked) {
            const box = document.createElement('span');
            box.className = 'poll-checkbox' + (checked ? ' checked' : '');
            box.setAttribute('aria-hidden', 'true');
            return box;
        }

        function _renderPollVotersModalBody(poll) {
            const body = document.getElementById('pollVotersModalBody');
            if (!body) return;

            body.innerHTML = '';
            poll.options.forEach(function(opt) {
                const block = document.createElement('div');
                block.className = 'poll-voters-option-block';

                const title = document.createElement('div');
                title.className = 'poll-voters-option-title';
                title.textContent = opt.text;
                block.appendChild(title);

                const voters = opt.voters || [];
                const meta = document.createElement('div');
                meta.className = 'poll-voters-option-meta';
                meta.textContent = tc('pollVotes', voters.length, voters.length + ' ' + tr('pollVotes', 'голосов'));
                block.appendChild(meta);

                if (voters.length) {
                    const list = document.createElement('div');
                    list.className = 'poll-voters-list';
                    voters.forEach(function(v) {
                        const person = document.createElement('div');
                        person.className = 'poll-voters-person';
                        const av = document.createElement('div');
                        av.className = 'poll-voters-avatar';
                        if (v.avatarUrl) {
                            av.innerHTML = '<img src="' + v.avatarUrl + '" alt="">';
                        } else {
                            av.textContent = (v.firstName || '?')[0].toUpperCase();
                        }
                        const name = document.createElement('div');
                        name.className = 'poll-voters-name';
                        name.textContent = v.firstName || tr('user', 'Пользователь');
                        person.appendChild(av);
                        person.appendChild(name);
                        list.appendChild(person);
                    });
                    block.appendChild(list);
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'poll-voters-empty';
                    empty.textContent = tr('pollVotesOptionEmpty', 'Пока никто не голосовал');
                    block.appendChild(empty);
                }

                body.appendChild(block);
            });
        }

        async function openPollVotersModal(messageId) {
            const msg = messagesData[messageId];
            const poll = msg && msg.poll;
            if (!poll || poll.isAnonymous) return;

            const modal = document.getElementById('pollVotersModal');
            const body = document.getElementById('pollVotersModalBody');
            if (!modal || !body) return;

            const hasVoters = poll.options.some(function(opt) {
                return Array.isArray(opt.voters) && opt.voters.length > 0;
            });
            if (!hasVoters) {
                body.innerHTML = '<div class="poll-voters-loading" style="padding:24px;text-align:center;color:var(--text-muted);font-size:14px;">' + tr('loading', 'Загрузка...') + '</div>';
                modal.classList.add('active');
                try {
                    const res = await fetch('/api/v1/polls/' + messageId, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    const data = await res.json();
                    if (res.ok && data.poll) {
                        messagesData[messageId].poll = data.poll;
                        _renderPollVotersModalBody(data.poll);
                    } else {
                        body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:14px;">' + tr('pollVoteError', 'Не удалось загрузить') + '</div>';
                    }
                } catch (err) {
                    console.error('Load poll voters error:', err);
                    body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:14px;">' + tr('pollVoteError', 'Не удалось загрузить') + '</div>';
                }
                if (window.i18n && window.i18n.translatePage) window.i18n.translatePage(modal);
                return;
            }

            _renderPollVotersModalBody(poll);
            modal.classList.add('active');
            if (window.i18n && window.i18n.translatePage) window.i18n.translatePage(modal);
        }

        function closePollVotersModal() {
            const modal = document.getElementById('pollVotersModal');
            if (modal) modal.classList.remove('active');
        }

        async function retractPollVote(messageId) {
            try {
                const res = await fetch('/api/v1/polls/' + messageId + '/vote', {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                if (!res.ok) {
                    showToast('error', data.error || tr('pollRetractError', 'Не удалось отменить голос'), '❌');
                    return;
                }
                delete _pollPendingSelections[messageId];
                if (data.poll) {
                    updatePollInMessage(messageId, data.poll);
                }
                showToast('success', tr('pollVoteRetracted', 'Голос отменён'), '✓');
            } catch (err) {
                console.error('Poll retract error:', err);
                showToast('error', tr('pollRetractError', 'Не удалось отменить голос'), '❌');
            }
        }

        function createPollPlaceholder(messageId, question) {
            const container = document.createElement('div');
            container.className = 'poll-message poll-message--loading';
            const header = document.createElement('div');
            header.className = 'poll-header';
            const q = document.createElement('div');
            q.className = 'poll-question';
            q.textContent = question || '…';
            header.appendChild(q);
            container.appendChild(header);
            return container;
        }

        function rememberPollPayload(messageId, poll) {
            if (messageId && poll) _pollPayloadCache.set(messageId, poll);
        }

        async function hydratePollsInChat(chatId, messages) {
            const pollIds = messages
                .filter(function(m) { return m.type === 'poll' && !m.poll; })
                .map(function(m) { return m.id; });
            if (!pollIds.length) return;

            const missing = pollIds.filter(function(id) { return !_pollPayloadCache.has(id); });
            try {
                if (missing.length) {
                    const res = await fetch('/api/v1/polls/batch?ids=' + encodeURIComponent(missing.join(',')), {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    const data = await res.json();
                    if (!res.ok || !data.polls) return;
                    Object.keys(data.polls).forEach(function(messageId) {
                        rememberPollPayload(messageId, data.polls[messageId]);
                    });
                }
                if (!activeChat || activeChat.id !== chatId) return;

                beginMessagesLayoutBatch();
                for (let i = 0; i < pollIds.length; i++) {
                    const messageId = pollIds[i];
                    const poll = _pollPayloadCache.get(messageId);
                    if (!poll || !messagesData[messageId]) continue;
                    messagesData[messageId].poll = poll;
                    refreshPollElement(messageId);
                }
                endMessagesLayoutBatch(false);
            } catch (err) {
                console.error('Hydrate polls error:', err);
                endMessagesLayoutBatch(false);
            }
        }

        function decryptMessagesInBackground(chatId, messages) {
            if (!window.E2E || !messages.length) return;
            messages.forEach(function(m) {
                if (m.type === 'poll' || !m.isEncrypted || !m.encryptionIv || m._isDecrypted) return;
                window.E2E.decrypt(m.content, m.encryptionIv, chatId, token).then(function(plain) {
                    if (!plain || plain === '🔒 [зашифровано]' || !messagesData[m.id]) return;
                    m.content = plain;
                    m._isDecrypted = true;
                    const el = document.querySelector('[data-message-id="' + m.id + '"]');
                    const textEl = el && el.querySelector('.message-text');
                    if (textEl) textEl.innerHTML = renderFormattedText(plain);
                }).catch(function() {});
            });
        }

        function createPollElement(messageId, poll) {
            const container = document.createElement('div');
            container.className = 'poll-message';

            const header = document.createElement('div');
            header.className = 'poll-header' + (poll.hasVoted ? ' poll-header--voted' : '');

            const headerText = document.createElement('div');
            headerText.className = 'poll-header-text';

            const question = document.createElement('div');
            question.className = 'poll-question';
            question.textContent = poll.question;
            headerText.appendChild(question);

            header.appendChild(headerText);

            if (poll.hasVoted) {
                const retractBtn = document.createElement('button');
                retractBtn.type = 'button';
                retractBtn.className = 'poll-retract-btn';
                retractBtn.setAttribute('data-tip', tr('pollRetractVote', 'Отменить голос'));
                retractBtn.setAttribute('aria-label', tr('pollRetractVote', 'Отменить голос'));
                retractBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h13a4 4 0 0 1 0 8H7"/><path d="M7 6L3 10l4 4"/></svg>';
                retractBtn.onclick = function(e) {
                    e.stopPropagation();
                    retractPollVote(messageId);
                };
                header.appendChild(retractBtn);
            }

            container.appendChild(header);

            const optionsWrap = document.createElement('div');
            optionsWrap.className = 'poll-options poll-options--static';
            const showResults = !!poll.hasVoted;
            const totalVoters = poll.totalVoters || 0;
            const pending = _getPollPendingSelection(messageId);
            const showCheckboxes = poll.allowMultiple && !showResults;

            const myVoteIds = new Set((poll.myVotes || []).map(String));

            poll.options.forEach(function(opt) {
                const isSelected = showResults
                    ? myVoteIds.has(String(opt.id))
                    : pending.has(opt.id);

                const optBtn = document.createElement('button');
                optBtn.type = 'button';
                optBtn.className = 'poll-option' + (isSelected ? ' selected' : '');
                if (showResults && isSelected) {
                    optBtn.classList.add('poll-option-voted');
                }
                optBtn.dataset.optionId = opt.id;
                optBtn.disabled = showResults;

                if (showResults) {
                    const pct = totalVoters > 0 ? Math.round((opt.voteCount / totalVoters) * 100) : 0;
                    const bar = document.createElement('div');
                    bar.className = 'poll-option-bar';
                    bar.style.width = pct + '%';
                    optBtn.appendChild(bar);

                    if (poll.allowMultiple) {
                        optBtn.appendChild(_createPollCheckbox(isSelected));
                    }

                    const row = document.createElement('div');
                    row.className = 'poll-option-row';
                    const text = document.createElement('span');
                    text.className = 'poll-option-text';
                    text.textContent = opt.text;
                    const pctEl = document.createElement('span');
                    pctEl.className = 'poll-option-pct';
                    pctEl.textContent = pct + '%';
                    row.appendChild(text);
                    row.appendChild(pctEl);
                    optBtn.appendChild(row);
                } else {
                    if (showCheckboxes) {
                        optBtn.appendChild(_createPollCheckbox(isSelected));
                    }
                    const label = document.createElement('span');
                    label.className = 'poll-option-label';
                    label.textContent = opt.text;
                    optBtn.appendChild(label);
                    optBtn.onclick = function(e) {
                        e.stopPropagation();
                        handlePollOptionClick(messageId, opt.id, poll);
                    };
                }

                optionsWrap.appendChild(optBtn);
            });
            container.appendChild(optionsWrap);
            requestAnimationFrame(function() {
                optionsWrap.classList.remove('poll-options--static');
            });

            if (!showResults && poll.allowMultiple) {
                const voteActions = document.createElement('div');
                voteActions.className = 'poll-vote-actions';
                const voteBtn = document.createElement('button');
                voteBtn.type = 'button';
                voteBtn.className = 'poll-vote-btn';
                voteBtn.textContent = tr('pollVote', 'Проголосовать');
                voteBtn.onclick = function(e) {
                    e.stopPropagation();
                    submitPendingPollVotes(messageId);
                };
                voteActions.appendChild(voteBtn);
                container.appendChild(voteActions);
            }

            if (showResults) {
                const footer = document.createElement('div');
                footer.className = 'poll-footer';

                if (!poll.isAnonymous && totalVoters > 0) {
                    const viewBtn = document.createElement('button');
                    viewBtn.type = 'button';
                    viewBtn.className = 'poll-view-votes-link';
                    viewBtn.textContent = tr('pollViewVotes', 'Посмотреть голоса ({count})', { count: totalVoters });
                    viewBtn.onclick = function(e) {
                        e.stopPropagation();
                        openPollVotersModal(messageId);
                    };
                    footer.appendChild(viewBtn);
                } else {
                    const summary = document.createElement('span');
                    summary.className = 'poll-votes-summary';
                    summary.textContent = tc('pollVotes', totalVoters, totalVoters + ' ' + tr('pollVotes', 'голосов'));
                    footer.appendChild(summary);
                }

                container.appendChild(footer);
            }

            return container;
        }

        function openGallery() {
            closeAttachmentPanel();
            document.getElementById('galleryInput').click();
        }


        function openStickerPicker() {
            document.getElementById('stickerModal').classList.add('active');
            loadStickerPacks();
        }

        function closeStickerModal() {
            document.getElementById('stickerModal').classList.remove('active');
        }

        function openCreatePackModal() {
            document.getElementById('createPackModal').classList.add('active');
        }

        function closeCreatePackModal() {
            document.getElementById('createPackModal').classList.remove('active');
            document.getElementById('newPackName').value = '';
            document.getElementById('newPackDesc').value = '';
            document.getElementById('newPackIcon').innerHTML = '<span>🎨</span>';
            newPackIconData = null;
        }

        document.getElementById('stickerModal').addEventListener('click', function(e) {
            if (e.target.id === 'stickerModal') closeStickerModal();
        });
        
        document.getElementById('createPackModal').addEventListener('click', function(e) { 
            if (e.target.id === 'createPackModal') closeCreatePackModal(); 
        });

        document.getElementById('pollModal').addEventListener('click', function(e) {
            if (e.target.id === 'pollModal') closePollModal();
        });

        // ============================================
        // FILE HANDLING
        // ============================================
        // FILE HANDLING
        // ============================================
        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
        let _pendingMediaDataUrl = null;
        let _pendingMediaType = null;

        function handleFileSelect(input) {
            const file = input.files[0];
            if (!file) return;
            input.value = '';

            if (file.size > MAX_FILE_SIZE) {
                showToast('error', tr('fileTooLarge50', 'Файл слишком большой. Максимум 50 МБ'), '❌');
                return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                const dataUrl = e.target.result;
                let type = 'file';
                if (file.type.startsWith('video')) type = 'video';
                else if (file.type.startsWith('image')) type = 'image';
                showMediaSendPreview(dataUrl, type);
            };
            reader.readAsDataURL(file);
        }

        function handleGifSelect(input) {
            const file = input.files[0];
            if (!file) return;
            input.value = '';

            if (file.size > MAX_FILE_SIZE) {
                showToast('error', 'Файл слишком большой. Максимум 50 МБ', '❌');
                return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                uploadFile(e.target.result, 'gif').then(function(url) {
                    if (url) {
                        saveGif(url, file.name);
                        showToast('success', tr('gifAdded', 'GIF добавлен'), '✓');
                    } else {
                        showToast('error', tr('loadingError', 'Ошибка загрузки'), '❌');
                    }
                }).catch(function() {
                    showToast('error', tr('loadingError', 'Ошибка загрузки'), '❌');
                });
            };
            reader.readAsDataURL(file);
        }

        function showMediaSendPreview(dataUrl, type) {
            _pendingMediaDataUrl = dataUrl;
            _pendingMediaType = type;

            const content = document.getElementById('mediaSendPreviewContent');
            const caption = document.getElementById('mediaSendCaption');
            const editBtnContainer = document.getElementById('editMediaBtnContainer');
            
            caption.innerText = '';

            if (type === 'video') {
                content.innerHTML = '<video src="' + dataUrl + '" controls style="max-width:100%;max-height:55vh;border-radius:12px;"></video>';
                if (editBtnContainer) editBtnContainer.style.display = 'none';
            } else {
                content.innerHTML = '<img id="mediaSendPreviewImg" src="' + dataUrl + '" style="max-width:100%;max-height:55vh;border-radius:12px;object-fit:contain;">';
                if (editBtnContainer) editBtnContainer.style.display = 'flex';
            }

            const modal = document.getElementById('mediaSendPreview');
            modal.style.display = 'flex';
            
            // Инициализация иконок Lucide
            if (window.lucide) {
                lucide.createIcons();
            }

            setTimeout(() => caption.focus(), 100);

            // Закрыть по Escape
            function onEsc(e) {
                if (e.key === 'Escape') { cancelMediaSend(); document.removeEventListener('keydown', onEsc); }
            }
            document.addEventListener('keydown', onEsc);
        }

        function openEditorFromPreview() {
            if (!_pendingMediaDataUrl) return;
            
            // Сохраняем изображение для редактора
            try {
                localStorage.setItem('craneapp_editor_image', _pendingMediaDataUrl);
                const modal = document.getElementById('photoEditorModal');
                const iframe = document.getElementById('photoEditorIframe');
                
                // Загружаем редактор в iframe
                iframe.src = '../../components/media-editor/photo-editor.html';
                modal.style.display = 'block';
                
                // Можно добавить анимацию или лоадер, если нужно
            } catch (e) {
                console.error('Editor open error:', e);
                showToast('error', 'Изображение слишком большое для редактора', '❌');
            }
        }

        // Глобальная функция для закрытия редактора из iframe
        window.closePhotoEditor = function() {
            const modal = document.getElementById('photoEditorModal');
            const iframe = document.getElementById('photoEditorIframe');
            if (modal) modal.style.display = 'none';
            if (iframe) iframe.src = 'about:blank'; // Очищаем память
        };

        // Получение результата из фоторедактора
        window.onPhotoEditorComplete = function(dataUrl) {
            _pendingMediaDataUrl = dataUrl;
            const previewImg = document.getElementById('mediaSendPreviewImg');
            if (previewImg) previewImg.src = dataUrl;
            
            // Если есть вьювер в фоне, обновляем и его (опционально)
            console.log('✅ Изображение обновлено после редактора');
        };

        function cancelMediaSend() {
            _pendingMediaDataUrl = null;
            _pendingMediaType = null;
            document.getElementById('mediaSendPreview').style.display = 'none';
        }

        function confirmMediaSend() {
            if (!_pendingMediaDataUrl || !_pendingMediaType) return;
            const dataUrl = _pendingMediaDataUrl;
            const type = _pendingMediaType;
            const caption = document.getElementById('mediaSendCaption').innerText.trim();
            document.getElementById('mediaSendPreview').style.display = 'none';
            _pendingMediaDataUrl = null;
            _pendingMediaType = null;

            if (type === 'gif') {
                saveGif(dataUrl);
                sendGifMessage(dataUrl, caption);
            } else {
                sendMediaMessage(dataUrl, type, caption);
            }
        }

        function handlePackIconSelect(input) {
            const file = input.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                newPackIconData = e.target.result;
                document.getElementById('newPackIcon').innerHTML = '<img src="' + newPackIconData + '" alt="">';
            };
            reader.readAsDataURL(file);
            input.value = '';
        }

        function handleStickerSelect(input) {
            const file = input.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                addStickerToCurrentPack(e.target.result);
            };
            reader.readAsDataURL(file);
            input.value = '';
        }

        // ============================================
        // SEND MEDIA MESSAGES
        // ============================================
        function sendMediaMessage(dataUrl, type, caption) {
            if (!activeChat) return;
            
            const tempId = 'temp-' + Date.now();
            const msg = {
                id: tempId,
                senderId: user.id,
                type: type,
                mediaUrl: dataUrl,
                content: caption || '',
                time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                senderName: user.firstName || 'Вы',
                parentMessageId: isCommentThreadActive() ? commentThreadPostId : null,
                pending: true
            };
            
            messagesData[tempId] = msg;
            appendMessageToActiveList(msg);
            
            uploadFile(dataUrl, type).then(function(url) {
                if (url) {
                    sendMediaToServer(url, type, tempId, caption);
                }
            });
        }

        function sendGifMessage(dataUrl, caption) {
            if (!activeChat) return;

            setTimeout(function() {
                var tempId = 'temp-' + Date.now();
                var msg = {
                    id: tempId,
                    senderId: user.id,
                    type: 'gif',
                    mediaUrl: dataUrl,
                    content: caption || '',
                    time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                    senderName: user.firstName || 'Вы',
                    parentMessageId: isCommentThreadActive() ? commentThreadPostId : null,
                    pending: true
                };

                messagesData[tempId] = msg;
                appendMessageToActiveList(msg);
                
                setTimeout(function() {
                    sendMediaToServer(dataUrl, 'gif', tempId, caption);
                }, 100);
            }, 100);
        }

        function sendStickerMessage(stickerUrl) {
            if (!activeChat) return;
            
            closeStickerModal();
            
            const tempId = 'temp-' + Date.now();
            const msg = {
                id: tempId,
                senderId: user.id,
                type: 'sticker',
                mediaUrl: stickerUrl,
                time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                senderName: user.firstName || 'Вы',
                parentMessageId: isCommentThreadActive() ? commentThreadPostId : null,
                pending: true
            };
            
            messagesData[tempId] = msg;
            appendMessageToActiveList(msg);
            
            if (stickerUrl.startsWith('data:')) {
                uploadFile(stickerUrl, 'sticker').then(function(url) {
                    if (url) {
                        sendMediaToServer(url, 'sticker', tempId);
                    }
                });
            } else {
                sendMediaToServer(stickerUrl, 'sticker', tempId);
            }
        }

        async function uploadFile(dataUrl, type) {
            try {
                const res = await fetch('/api/v1/upload', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ file: dataUrl, type: type })
                });
                const data = await res.json();
                return data.url;
            } catch (err) {
                console.error('Upload error:', err);
                showToast('error', tr('loadingError', 'Ошибка загрузки'), '❌');
                return null;
            }
        }

        function sendMediaToServer(mediaUrl, mediaType, tempId, caption) {
            if (!activeChat) return;

            const mediaBody = {
                content: caption || '',
                type: mediaType,
                mediaUrl: mediaUrl,
                mediaType: mediaType,
                topicId: activeTopic ? activeTopic.id : null
            };
            if (isCommentThreadActive() && commentThreadPostId) {
                mediaBody.parentMessageId = commentThreadPostId;
                delete mediaBody.topicId;
            }

            fetch('/api/v1/messages/' + activeChat.id, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify(mediaBody)
            }).then(function(res) {
                return res.json();
            }).then(function(data) {
                if (data.message) {
                    _confirmMessage(tempId, data.message);
                }
            }).catch(function(err) {
                showToast('error', tr('sendError', 'Ошибка отправки'), '❌');
            });
        }

        // Подтвердить сообщение: убрать pending, заменить часы на галочку
        function _confirmMessage(tempId, serverMessage) {
            const tempEl = document.querySelector('[data-message-id="' + tempId + '"]');
            if (!tempEl) return;
            tempEl.dataset.messageId = serverMessage.id;
            tempEl.classList.remove('pending');
            const span = tempEl.querySelector('.msg-time span');
            if (span) {
                span.innerHTML = '<svg width="12" height="10" viewBox="0 0 12 10" fill="none" style="opacity:.7"><path d="M1 5l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            }
            if (tempEl.classList.contains('channel-post')) {
                const commentsBtn = tempEl.querySelector('.channel-post-comments-btn');
                if (commentsBtn) {
                    commentsBtn.disabled = false;
                    commentsBtn.dataset.postId = serverMessage.id;
                }
            }
            delete messagesData[tempId];
            messagesData[serverMessage.id] = serverMessage;
            if (commentThreadPostId && serverMessage.parentMessageId === commentThreadPostId) {
                bumpPostCommentCount(commentThreadPostId, serverMessage);
            }
        }

        function createMessageElement(m) {
            const div = document.createElement('div');
            const isOutgoing = m.senderId === user.id || m.outgoing;
            const isBotMessage = isCraneAppBotMessage(m);
            const isGroup = activeChat && activeChat.type === 'group';
            const isChannel = activeChat && activeChat.type === 'channel';
            const inCommentThread = isCommentThreadActive() || !!(m.parentMessageId || m.parent_message_id);
            const isChannelPost = isChannelPostMessage(m);

            div.className = 'message ' + (isOutgoing ? 'outgoing' : 'incoming');
            if (isChannelPost) div.classList.add('channel-post');
            if (inCommentThread) div.classList.add('channel-comment-msg');
            if (m.pending) div.classList.add('pending');
            if (isBotMessage) div.classList.add('bot-message');
            if (m.isPinned) div.classList.add('pinned');
            if (m.type === 'poll') {
                div.classList.add('poll-msg', 'text-msg');
            } else if (!m.type || m.type === 'text') {
                div.classList.add('text-msg');
            } else {
                div.classList.add('media-msg');
            }
            div.dataset.messageId = m.id;

            div.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                // Читаем актуальный ID из dataset (он обновляется после отправки)
                const actualId = div.dataset.messageId || m.id;
                showMessageContextMenu(e, actualId, div, m.content || '', m.senderName || tr('user', 'Пользователь'));
            });

            let pressTimer;
            div.addEventListener('touchstart', function(e) {
                pressTimer = setTimeout(function() {
                    const actualId = div.dataset.messageId || m.id;
                    showMessageContextMenu(e.touches[0], actualId, div, m.content || '', m.senderName || tr('user', 'Пользователь'));
                }, 500);
            });
            div.addEventListener('touchend', function() { clearTimeout(pressTimer); });
            div.addEventListener('touchmove', function() { clearTimeout(pressTimer); });

            // ── Аватарка и имя отправителя в группах и комментариях к постам ──
            if ((isGroup || (isChannel && inCommentThread)) && !isOutgoing) {
                const senderName = m.senderFirstName || m.sender?.firstName || m.senderName || '';
                const senderIsBot = m.senderUsername === 'craneapp_bot' || m.isBot || m.sender?.isBot;
                const senderBadgeHtml = renderBadges(
                    m.senderBadges || (m.senderBadge ? [m.senderBadge] : []) || m.sender?.badges || [],
                    senderIsBot,
                    m.senderIsPremium || m.sender?.isPremium,
                    false, false
                );
                // Source avatar if provided, otherwise fallback to camera indicator if available
                const senderAv = m.senderAvatar
                    || m.sender?.avatarUrl
                    || m.sender?.avatar
                    || m.senderAvatarUrl
                    || m.avatarUrl
                    || '';
                const initial = senderName ? senderName[0].toUpperCase() : '';
                const camAvailable = typeof window.__CAMERA_HAS__ !== 'undefined' ? window.__CAMERA_HAS__ : false;
                // Для бота показываем 🤖, для остальных - аватарку или камеру/инициал
                const avatarContent = senderIsBot
                    ? '<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:28px;">🤖</span>'
                    : senderAv
                        ? `<img src="${senderAv}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
                        : camAvailable
                            ? '<span class="camera-icon" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%">📷</span>'
                            : (initial || '?');

                const wrapper = document.createElement('div');
                wrapper.className = 'msg-group-wrapper';
                wrapper.innerHTML = `
                    <div class="msg-sender-avatar">${avatarContent}</div>
                    <div class="msg-group-content">
                        <div class="msg-sender-name">${senderName}${senderBadgeHtml}</div>
                    </div>
                `;
                // Сообщение будет добавлено внутрь msg-group-content
                const contentDiv = wrapper.querySelector('.msg-group-content');
                // Переносим div внутрь wrapper
                div.classList.add('group-msg');
                contentDiv.appendChild(div);

                // Reply preview
                const replyData = m.replyToData || (m.replyToMessageId ? {
                    senderName: m.replyToSenderName || (messagesData[m.replyToMessageId] ? (messagesData[m.replyToMessageId].senderFirstName || messagesData[m.replyToMessageId].senderName || messagesData[m.replyToMessageId].sender?.firstName) : null) || tr('user', 'Пользователь'),
                    content: m.replyToContent || (messagesData[m.replyToMessageId] ? messagesData[m.replyToMessageId].content : '') || ''
                } : null);
                if (replyData) {
                    const rp = document.createElement('div');
                    rp.className = 'msg-reply-preview';
                    rp.innerHTML = `
                    <div class="msg-reply-header">
                        <svg class="msg-reply-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 14 4 9 9 4"/>
                            <path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
                        </svg>
                        <span class="msg-reply-label">Ответ</span>
                        <span class="msg-reply-sender">${replyData.senderName}</span>
                    </div>
                    <div class="msg-reply-text">${(replyData.content||'').substring(0,80)}</div>
                `;
                    rp.onclick = function(e) {
                        e.stopPropagation();
                        const rid = m.replyToMessageId || m.replyToData?.messageId;
                        if (rid) {
                            const t = document.querySelector('[data-message-id="'+rid+'"]');
                            if (t) { t.scrollIntoView({behavior:'smooth',block:'center'}); t.classList.add('highlight'); setTimeout(()=>t.classList.remove('highlight'),1500); }
                        }
                    };
                    div.insertBefore(rp, div.firstChild);
                }

                addMessageContent(div, m);
                return wrapper;
            }

            // ── Reply preview (не группа) ──────────────────────────────
            const replyData = m.replyToData || (m.replyToMessageId ? {
                senderName: m.replyToSenderName || (messagesData[m.replyToMessageId] ? (messagesData[m.replyToMessageId].senderFirstName || messagesData[m.replyToMessageId].senderName || messagesData[m.replyToMessageId].sender?.firstName) : null) || tr('user', 'Пользователь'),
                content: m.replyToContent || (messagesData[m.replyToMessageId] ? messagesData[m.replyToMessageId].content : '') || ''
            } : null);
            if (replyData) {
                const rp = document.createElement('div');
                rp.className = 'msg-reply-preview';
                rp.innerHTML = `
                    <div class="msg-reply-header">
                        <svg class="msg-reply-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 14 4 9 9 4"/>
                            <path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
                        </svg>
                        <span class="msg-reply-label">Ответ</span>
                        <span class="msg-reply-sender">${replyData.senderName}</span>
                    </div>
                    <div class="msg-reply-text">${(replyData.content||'').substring(0,80)}</div>
                `;
                rp.onclick = function(e) {
                    e.stopPropagation();
                    const rid = m.replyToMessageId || m.replyToData?.messageId;
                    if (rid) {
                        const t = document.querySelector('[data-message-id="'+rid+'"]');
                        if (t) { t.scrollIntoView({behavior:'smooth',block:'center'}); t.classList.add('highlight'); setTimeout(()=>t.classList.remove('highlight'),1500); }
                    }
                };
                div.appendChild(rp);
            }

            addMessageContent(div, m);
            return div;
        }

        function addMessageContent(div, m) {
            // Метка "Переслано от ..." — стиль как в Telegram
            if (m.forwardFrom) {
                const fwd = document.createElement('div');
                fwd.style.cssText = 'border-left:3px solid var(--accent-color);padding:4px 8px;margin-bottom:6px;border-radius:0 4px 4px 0;background:rgba(255,0,127,0.06);';
                fwd.innerHTML = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:1px;">Переслано от</div>'
                    + '<div style="font-size:13px;color:var(--accent-color);font-weight:600;">' + m.forwardFrom + '</div>';
                div.appendChild(fwd);
            }
            if (m.type === 'image' || m.type === 'photo') {
                div.classList.add('media-only');
                const img = document.createElement('img');
                img.className = 'message-media';
                img.src = m.mediaUrl;
                img.onclick = function() { openMediaPreview(m.mediaUrl, 'image'); };
                div.appendChild(img);
                if (m.content) {
                    div.classList.remove('media-only');
                    const cap = document.createElement('div');
                    cap.className = 'message-caption';
                    cap.textContent = isCraneAppBotMessage(m) ? localizeBotMessageText(m.content) : m.content;
                    div.appendChild(cap);
                }
            } else if (m.type === 'video') {
                const video = document.createElement('video');
                video.className = 'message-media';
                video.src = m.mediaUrl;
                video.controls = true;
                video.onclick = function() { openMediaPreview(m.mediaUrl, 'video'); };
                div.appendChild(video);
                if (m.content) {
                    const cap = document.createElement('div');
                    cap.className = 'message-caption';
                    cap.textContent = isCraneAppBotMessage(m) ? localizeBotMessageText(m.content) : m.content;
                    div.appendChild(cap);
                }
            } else if (m.type === 'gif') {
                div.classList.add('media-only');
                const img = document.createElement('img');
                img.className = 'message-gif';
                img.src = m.mediaUrl;
                img.onclick = function() { openMediaPreview(m.mediaUrl, 'gif'); };
                div.appendChild(img);
                if (m.content) {
                    div.classList.remove('media-only');
                    const cap = document.createElement('div');
                    cap.className = 'message-caption';
                    cap.textContent = isCraneAppBotMessage(m) ? localizeBotMessageText(m.content) : m.content;
                    div.appendChild(cap);
                }
            } else if (m.type === 'sticker') {
                div.classList.add('sticker-only');
                const img = document.createElement('img');
                img.className = 'message-sticker';
                img.src = m.mediaUrl;
                img.onclick = function() { openMediaPreview(m.mediaUrl, 'image'); };
                div.appendChild(img);
            } else if (m.type === 'video_note') {
                const noteEl = createVideoNoteElement(m.mediaUrl, m.voiceDuration || 0);
                div.appendChild(noteEl);
            } else if (m.type === 'poll') {
                div.appendChild(m.poll
                    ? createPollElement(m.id, m.poll)
                    : createPollPlaceholder(m.id, m.content || m.contentPlain));
            } else if (m.type === 'call') {
                let callData = {};
                try { callData = JSON.parse(m.content || '{}'); } catch(_) {}
                const isOutgoingCall = (m.sender_id || m.senderId) === user.id;
                const isVideo = callData.callKind !== 'audio';
                const isMissed = callData.status === 'missed';
                const dur = callData.duration || 0;
                const durStr = dur > 0
                    ? (Math.floor(dur/60) + ':' + String(dur%60).padStart(2,'0'))
                    : '';
                const label = isMissed
                    ? (isOutgoingCall ? tr('unansweredCall', 'Звонок без ответа') : tr('incomingMissedCall', 'Пропущенный звонок'))
                    : (isVideo ? tr('videoCall', 'Видеозвонок') : tr('audioCall', 'Аудиозвонок'));
                const callIcon = isVideo
                    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>'
                    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.84a16 16 0 0 0 6 6l.94-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.63 16l.36.95z"/></svg>';
                const callEl = document.createElement('div');
                callEl.style.cssText = 'display:flex;align-items:center;gap:9px;padding:2px 0;';
                const iconWrap = document.createElement('span');
                iconWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;flex-shrink:0;'
                    + (isMissed ? 'background:rgba(255,75,98,0.15);color:#ff4b62;' : 'background:rgba(155,130,255,0.15);color:#9b82ff;');
                iconWrap.innerHTML = callIcon;
                const textWrap = document.createElement('span');
                textWrap.style.cssText = 'display:flex;flex-direction:column;gap:1px;';
                const labelEl = document.createElement('span');
                labelEl.style.cssText = 'font-size:13.5px;font-weight:600;' + (isMissed ? 'color:#ff4b62;' : '');
                labelEl.textContent = label;
                textWrap.appendChild(labelEl);
                if (durStr) {
                    const durEl = document.createElement('span');
                    durEl.style.cssText = 'font-size:11px;opacity:.6;';
                    durEl.textContent = durStr;
                    textWrap.appendChild(durEl);
                }
                callEl.appendChild(iconWrap);
                callEl.appendChild(textWrap);
                div.appendChild(callEl);
            } else {
                const textSpan = document.createElement('span');
                textSpan.className = 'message-text';
                // Убираем префикс "↪️ Переслано от X:\n" если есть forwardFrom
                let displayContent = m.content || m.text || m.contentPlain || m.content_plain || '';
                if (m.forwardFrom && displayContent.startsWith('↪️ Переслано от ')) {
                    const nlIdx = displayContent.indexOf('\n');
                    if (nlIdx !== -1) displayContent = displayContent.substring(nlIdx + 1);
                }
                if (isCraneAppBotMessage(m)) {
                    displayContent = localizeBotMessageText(displayContent);
                }
                textSpan.innerHTML = renderFormattedText(displayContent);
                
                // Check if message is purely emoji (1 to 3 emojis)
                const stripped = displayContent.replace(/[\s\n\r]/g, '');
                if (stripped.length > 0 && stripped.length <= 15 && !m.forwardFrom && !m.replyToMessageId && !m.replyToData) {
                    const noEmojis = stripped.replace(/(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\u200d|[\uFE00-\uFE0F])/gu, '');
                    if (noEmojis.length === 0) {
                        const emojiMatch = stripped.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu);
                        if (emojiMatch && emojiMatch.length > 0 && emojiMatch.length <= 3) {
                            div.classList.add('emoji-only-msg');
                        }
                    }
                }
                
                // Add spacer for time to prevent overlapping in shrink-to-fit layout
                const spacer = document.createElement('span');
                spacer.className = 'msg-time-spacer';
                textSpan.appendChild(spacer);
                
                div.appendChild(textSpan);
            }
            
            const timeDiv = document.createElement('div');
            timeDiv.className = 'msg-time';
            const timeText = m.time || (m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '');
            const isOutgoingMsg = m.senderId === user.id || m.outgoing;
            if (isChannelPostMessage(m)) {
                timeDiv.className = 'msg-time channel-post-meta';
                const views = m.viewsCount || 0;
                if (typeof window.buildChannelPostMetaHtml === 'function') {
                    timeDiv.innerHTML = window.buildChannelPostMetaHtml(views, timeText);
                } else {
                    timeDiv.textContent = timeText;
                }
            } else if (isOutgoingMsg) {
                // Глазик: pending = часы, sent = одна галочка, read = две галочки
                let statusIcon = '';
                if (m.pending) {
                    statusIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.75"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
                } else if (m.isRead || m.status === 'read') {
                    statusIcon = '<svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 5l3 3 5-7" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5l3 3 5-7" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                } else {
                    statusIcon = '<svg width="12" height="10" viewBox="0 0 12 10" fill="none" style="opacity:.85"><path d="M1 5l3 3 7-7" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                }
                timeDiv.innerHTML = timeText + ' <span style="display:inline-flex;align-items:center;margin-left:2px;vertical-align:middle">' + statusIcon + '</span>';
            } else {
                timeDiv.textContent = timeText;
            }
            div.appendChild(timeDiv);
            
            // Реакции
            if (m.reactions && m.reactions.length > 0) {
                const reactionsEl = createReactionsElement(m.id, m.reactions);
                div.appendChild(reactionsEl);
            }

            if (isChannelPostMessage(m)) {
                if (m.authorSignature) {
                    const sig = document.createElement('div');
                    sig.className = 'channel-post-signature';
                    sig.textContent = m.authorSignature;
                    div.insertBefore(sig, div.firstChild);
                }
                if (m.scheduledAt && !m.publishedAt) {
                    const sched = document.createElement('div');
                    sched.className = 'channel-post-scheduled';
                    const clockIcon = typeof window.chIcon === 'function' ? window.chIcon('clock', 13) : '';
                    sched.innerHTML = '<span class="channel-post-stat-icon" aria-hidden="true">' + clockIcon + '</span>'
                        + '<span>' + tr('scheduledPost', 'Отложенная публикация') + '</span>';
                    div.insertBefore(sched, div.firstChild);
                }
                const footer = document.createElement('div');
                footer.className = 'channel-post-footer';
                const comments = m.commentCount || 0;
                const commentPreview = m.commentPreview || [];
                if (typeof window.buildChannelPostFooter === 'function') {
                    footer.innerHTML = window.buildChannelPostFooter(comments, m.id, commentPreview);
                } else {
                    footer.innerHTML = '<button type="button" class="channel-post-comments-btn"'
                        + (m.pending ? ' disabled' : '')
                        + ' onclick="event.stopPropagation();openChannelCommentsFromPost(this)">' + comments + '</button>';
                }
                div.appendChild(footer);
            }
            
            return div;
        }

        // ============================================
        // EMOJI PICKER
        // ============================================
        function toggleEmojiPicker() {
            const picker = document.getElementById('emojiPicker');
            const btn = document.getElementById('emojiBtn');
            const input = document.getElementById('msgInput');
            
            // Prevent losing focus if we want to keep caret
            if (document.activeElement === input) {
                // Focus will be retained if button is clicked, but wait: button click already happened.
            }

            if (!picker) {
                console.error('emojiPicker element not found');
                return;
            }

            if (picker.classList.contains('active')) {
                closeEmojiPicker();
            } else {
                picker.classList.add('active');
                btn.classList.add('active');

                // Закрываем другие панели
                closeAttachmentPanel();
                renderEmojiPicker();
            }
        }

        function closeEmojiPicker() {
            document.getElementById('emojiPicker').classList.remove('active');
            document.getElementById('emojiBtn').classList.remove('active');
        }

        function switchEmojiTab(tab, btn) {
            console.log('Switching to tab:', tab);
            // Update tab buttons
            document.querySelectorAll('.emoji-tab').forEach(function(b) {
                b.classList.remove('active');
            });
            if (btn) btn.classList.add('active');

            const emojiTab = document.getElementById('emojiTabContent');
            const gifTab = document.getElementById('gifTabContent');
            const stickerTab = document.getElementById('stickerTabContent');
            emojiTab.style.display = tab === 'emoji' ? 'flex' : 'none';
            gifTab.style.display = tab === 'gif' ? 'flex' : 'none';
            stickerTab.style.display = tab === 'sticker' ? 'flex' : 'none';
            if (tab === 'gif') {
                console.log('Loading GIFs...');
                loadGifs('');
            }
            if (tab === 'sticker') loadStickers();
        }

        // ── GIF в эмодзи-пикере ───────────────────────────────────────────
        let gifDebounce;
        let currentGifTab = 'all'; // 'all' or 'favorites'

        function switchGifTab(tab) {
            currentGifTab = tab;
            const btnAll = document.getElementById('gifTabAll');
            const btnFav = document.getElementById('gifTabFavorites');

            if (tab === 'all') {
                btnAll.style.background = 'var(--accent-color)';
                btnAll.style.color = '#fff';
                btnFav.style.background = 'var(--bg-tertiary)';
                btnFav.style.color = 'var(--text-primary)';
            } else {
                btnFav.style.background = 'var(--accent-color)';
                btnFav.style.color = '#fff';
                btnAll.style.background = 'var(--bg-tertiary)';
                btnAll.style.color = 'var(--text-primary)';
            }

            loadGifs(document.getElementById('gifSearch') ? document.getElementById('gifSearch').value : '');
        }

        function searchGifs(q) {
            clearTimeout(gifDebounce);
            gifDebounce = setTimeout(function() { loadGifs(q); }, 300);
        }

        async function loadGifs(query) {
            const grid = document.getElementById('emojiGifGrid');
            if (!grid) return;

            try {
                const endpoint = currentGifTab === 'favorites' ? '/api/v1/gifs/favorites' : '/api/v1/gifs';
                const res = await fetch(endpoint, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });

                if (!res.ok) throw new Error('Failed to load GIFs');
                const data = await res.json();
                const allGifs = data.gifs || [];

                const filtered = query
                    ? allGifs.filter(function(g) { return (g.name || '').toLowerCase().includes(query.toLowerCase()); })
                    : allGifs;

                grid.innerHTML = '';
                if (!filtered.length) {
                    const message = currentGifTab === 'favorites'
                        ? tr('noFavoriteGifs', 'Нет избранных GIF')
                        : tr('noGifsAdd', 'Нет GIF. Нажмите «+ GIF» чтобы добавить');
                    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">'
                        + '<div style="font-size:32px;opacity:.4;margin-bottom:8px">🎞️</div>'
                        + '<div style="font-size:13px">' + message + '</div></div>';
                    return;
                }

                const limitedGifs = currentGifTab === 'favorites' ? filtered.slice(0, 50) : filtered;

                limitedGifs.forEach(function(gif) {
                    const item = document.createElement('div');
                    item.style.cssText = 'cursor:pointer;border-radius:8px;background:var(--bg-tertiary);position:relative;';

                    const img = document.createElement('img');
                    img.src = gif.url;
                    img.style.cssText = 'width:100%;height:auto;display:block;';
                    img.loading = 'lazy';
                    img.onclick = function() {
                        setTimeout(function() {
                            closeEmojiPicker();
                            sendGifMessage(gif.url);
                        }, 50);
                    };

                    const favBtn = document.createElement('button');
                    favBtn.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:50%;width:24px;height:24px;font-size:14px;cursor:pointer;';
                    favBtn.textContent = currentGifTab === 'favorites' ? '−' : '★';
                    favBtn.onclick = function(e) {
                        e.stopPropagation();
                        toggleGifFavorite(gif);
                    };

                    item.appendChild(img);
                    item.appendChild(favBtn);
                    grid.appendChild(item);
                });
            } catch (error) {
                grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">' + tr('loadingError', 'Ошибка загрузки') + '</div>';
            }
        }

        async function toggleGifFavorite(gif) {
            try {
                const method = currentGifTab === 'favorites' ? 'DELETE' : 'POST';
                await fetch('/api/v1/gifs/' + gif.id + '/favorite', {
                    method: method,
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                loadGifs(document.getElementById('gifSearch') ? document.getElementById('gifSearch').value : '');
            } catch (error) {
                showToast('error', tr('error', 'Ошибка'), '❌');
            }
        }

        // ── Стикеры в эмодзи-пикере ───────────────────────────────────────
        var emojiCurrentPackIdx = null;

        function loadStickers() {
            loadStickerPacks();
            emojiRenderPacksList();
        }

        function emojiRenderPacksList() {
            const container = document.getElementById('emojiStickerPacks');
            if (!container) return;
            container.innerHTML = '';

            // Рендерим все паки (теперь только личные)
            stickerPacks.forEach(function(pack, i) {
                const btn = document.createElement('button');
                const isActive = emojiCurrentPackIdx === i;
                btn.style.cssText = 'background:' + (isActive ? 'var(--accent-color)' : 'var(--bg-tertiary)') + ';border:none;border-radius:8px;padding:4px 10px;font-size:12px;color:' + (isActive ? '#fff' : 'var(--text-primary)') + ';cursor:pointer;white-space:nowrap;flex-shrink:0;';
                btn.textContent = pack.name;
                btn.onclick = function(e) {
                    e.stopPropagation();
                    emojiCurrentPackIdx = i;
                    emojiRenderPacksList();
                };
                container.appendChild(btn);
            });

            emojiRenderStickerGrid();
        }

        function emojiRenderStickerGrid() {
            const grid = document.getElementById('emojiStickerGrid');
            const nameEl = document.getElementById('emojiStickerPackName');
            const addBtn = document.getElementById('emojiAddStickerBtn');
            if (!grid) return;
            if (emojiCurrentPackIdx === null || !stickerPacks[emojiCurrentPackIdx]) {
                grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);font-size:13px">' + tr('choosePackOrCreate', 'Выберите пак или создайте новый') + '</div>';
                if (nameEl) {
                    nameEl.setAttribute('data-i18n', 'choosePack');
                    nameEl.textContent = tr('choosePack', 'Выберите пак');
                }
                if (addBtn) addBtn.style.display = 'none';
                return;
            }
            const pack = stickerPacks[emojiCurrentPackIdx];
            if (nameEl) {
                nameEl.removeAttribute('data-i18n');
                nameEl.textContent = pack.name;
            }
            // Показываем кнопку добавления только для личных паков
            if (addBtn) addBtn.style.display = !pack.isCommon ? 'block' : 'none';
            grid.innerHTML = '';
            (pack.stickers || []).forEach(function(url, si) {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'position:relative;border-radius:8px;overflow:hidden;cursor:pointer;aspect-ratio:1;background:var(--bg-tertiary);';
                const img = document.createElement('img');
                img.src = url;
                img.style.cssText = 'width:100%;height:100%;object-fit:contain;padding:4px;';
                img.onclick = function() { closeEmojiPicker(); sendStickerMessage(url); };
                // Кнопка удаления только для личных паков
                if (!pack.isCommon) {
                    const del = document.createElement('button');
                    del.textContent = '×';
                    del.style.cssText = 'position:absolute;top:2px;right:2px;background:rgba(0,0,0,.65);border:none;color:#fff;border-radius:50%;width:16px;height:16px;font-size:11px;cursor:pointer;line-height:1;';
                    del.onclick = async function(e) {
                        e.stopPropagation();
                        try {
                            // Получаем ID стикера из данных пака
                            const stickerId = pack.stickerIds ? pack.stickerIds[si] : null;
                            if (!stickerId) {
                                // Fallback: удаляем по индексу локально
                                stickerPacks[emojiCurrentPackIdx].stickers.splice(si, 1);
                                emojiRenderStickerGrid();
                                return;
                            }
                            const res = await fetch('/api/v1/stickers/packs/' + pack.id + '/stickers/' + stickerId, {
                                method: 'DELETE',
                                headers: { 'Authorization': 'Bearer ' + token }
                            });
                            if (res.ok) {
                                stickerPacks[emojiCurrentPackIdx].stickers.splice(si, 1);
                                if (stickerPacks[emojiCurrentPackIdx].stickerIds) {
                                    stickerPacks[emojiCurrentPackIdx].stickerIds.splice(si, 1);
                                }
                                emojiRenderStickerGrid();
                            }
                        } catch (error) {
                            console.error('Delete sticker error:', error);
                        }
                    };
                    wrap.appendChild(del);
                }
                // Контекстное меню для стикера
                wrap.oncontextmenu = function(e) {
                    e.preventDefault();
                    showStickerContextMenu(e, pack, url);
                };
                wrap.appendChild(img);
                grid.appendChild(wrap);
            });
            if (!pack.stickers || !pack.stickers.length) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:13px">' + (pack.isCommon ? (window.i18n?.t('stickersSoon') || 'Скоро здесь появятся стикеры') : (window.i18n?.t('noStickers') || 'Нет стикеров. Нажмите «+ Стикер»')) + '</div>';
            }
        }

        function emojiAddStickerToPack() {
            if (emojiCurrentPackIdx === null) { showToast('error', tr('choosePack', 'Выберите пак'), '❌'); return; }
            // Переключаем currentStickerPackId чтобы addStickerToCurrentPack работал правильно
            currentStickerPackId = emojiCurrentPackIdx;
            document.getElementById('stickerInput').click();
        }

        function emojiOpenCreatePack() {
            openCreatePackModal();
        }

        function showStickerContextMenu(e, pack, stickerUrl) {
            e.preventDefault();
            e.stopPropagation();

            // Удаляем старое меню если есть
            const oldMenu = document.getElementById('stickerContextMenu');
            if (oldMenu) oldMenu.remove();

            const menu = document.createElement('div');
            menu.id = 'stickerContextMenu';
            menu.style.cssText = 'position:fixed;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:1000;min-width:200px;padding:4px 0;';

            // Копировать ссылку на стикер-пак
            const copyLinkItem = document.createElement('div');
            copyLinkItem.style.cssText = 'padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-primary);transition:background 0.1s;';
            copyLinkItem.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>' + tr('copyLink', 'Скопировать ссылку') + '</span>';
            copyLinkItem.onclick = function() {
                const link = window.location.origin + '/stickers/' + pack.id;
                navigator.clipboard.writeText(link).then(function() {
                    showToast('success', tr('linkCopied', 'Ссылка скопирована'), '📋');
                });
                menu.remove();
            };
            copyLinkItem.onmouseover = function() { this.style.background = 'var(--bg-tertiary)'; };
            copyLinkItem.onmouseout = function() { this.style.background = 'transparent'; };
            menu.appendChild(copyLinkItem);

            // Добавить стикер-пак в мои (только для общих паков)
            if (pack.isCommon) {
                const addToMyItem = document.createElement('div');
                addToMyItem.style.cssText = 'padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-primary);transition:background 0.1s;';
                addToMyItem.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg><span>' + tr('addToMyStickers', 'Добавить в мои стикеры') + '</span>';
                addToMyItem.onclick = function() {
                    addStickerPackToPersonal(pack);
                    menu.remove();
                };
                addToMyItem.onmouseover = function() { this.style.background = 'var(--bg-tertiary)'; };
                addToMyItem.onmouseout = function() { this.style.background = 'transparent'; };
                menu.appendChild(addToMyItem);
            }

            // Позиционируем меню
            const x = e.clientX;
            const y = e.clientY;
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';

            document.body.appendChild(menu);

            // Закрытие при клике вне меню
            setTimeout(function() {
                document.addEventListener('click', function closeMenu(e) {
                    if (!menu.contains(e.target)) {
                        menu.remove();
                        document.removeEventListener('click', closeMenu);
                    }
                });
            }, 0);
        }

        function addStickerPackToPersonal(pack) {
            // Проверяем, не добавлен ли уже
            const personalPacks = stickerPacks.filter(p => !p.isCommon);
            const alreadyExists = personalPacks.some(p => p.name === pack.name);

            if (alreadyExists) {
                showToast('error', tr('packAlreadyAdded', 'Этот пак уже добавлен'), '❌');
                return;
            }

            // Создаем копию пака для личных
            const newPack = {
                id: 'personal_' + Date.now(),
                name: pack.name,
                icon: pack.icon,
                stickers: [...(pack.stickers || [])],
                isCommon: false
            };

            stickerPacks.push(newPack);
            saveStickerPacks();
            renderStickerPacksList();
            emojiRenderPacksList();
            showToast('success', tr('stickerPackAdded', 'Стикерпак добавлен'), '✨');
        }

        function renderEmojiPicker() {
            renderEmojiCategories();
            // Рендерим текущую категорию или smileys по умолчанию
            renderEmojis(currentEmojiCategory || 'smileys');
        }

        function renderEmojiCategories() {
            const container = document.getElementById('emojiCategories');
            container.innerHTML = '';
            
            const categories = ['recent', 'smileys', 'animals', 'food', 'activities', 'travel', 'objects', 'symbols'];
            
            categories.forEach(function(cat) {
                const btn = document.createElement('button');
                btn.className = 'emoji-cat' + (cat === currentEmojiCategory ? ' active' : '');
                btn.innerHTML = window.EmojiCategories && window.EmojiCategories[cat] ? window.EmojiCategories[cat].icon : '😀';
                btn.onclick = function() {
                    currentEmojiCategory = cat;
                    document.querySelectorAll('.emoji-cat').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    renderEmojis(cat);
                };
                container.appendChild(btn);
            });
        }

        // Базовый набор эмодзи на случай если EmojiData не загружена
        const DEFAULT_EMOJIS = {
            'smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
            'animals': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿️','🦔'],
            'food': ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🍍','🥭','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🌮','🌯','🥙','🧆','🥚','🍳','🥘','🍲','🥣','🥗','🍿','🧈','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🍡','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽️','🥣','🥡','🥢','🧂'],
            'activities': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🏋️‍♂️','🏋️‍♀️','🤼','🤼‍♂️','🤼‍♀️','🤸','🤸‍♂️','🤸‍♀️','⛹️','⛹️‍♂️','⛹️‍♀️','🤺','🤾','🤾‍♂️','🤾‍♀️','🏌️','🏌️‍♂️','🏌️‍♀️','🏇','🧘','🧘‍♂️','🧘‍♀️','🏄','🏄‍♂️','🏄‍♀️','🏊','🏊‍♂️','🏊‍♀️','🤽','🤽‍♂️','🤽‍♀️','🚣','🚣‍♂️','🚣‍♀️','🧗','🧗‍♂️','🧗‍♀️','🚵','🚵‍♂️','🚵‍♀️','🚴','🚴‍♂️','🚴‍♀️','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🤹‍♂️','🤹‍♀️','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','🎯','🎳','🎮','🎰','🧩'],
            'travel': ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍️','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','⛽','🚧','🚦','🚥','🚏','🗺️','🧭','🧳','🌎','🌍','🌏','🌐','🗾','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🧱','🪨','🪵','🛖','🏘️','🏚️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','♨️','🎠','🎡','🎢','💈','🎪'],
            'objects': ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧱','🔪','🗡️','⚔️','🛡️','🚬','⚰️','⚱️','🗿','🪦','🧿','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','💊','💉','🩸','🧬','🦠','🧫','🧪','🌡️','🧹','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🪥','🪒','🧽','🛎️','🔑','🗝️','🚪','🪑','🛋️','🛏️','🛌','🧸','🪆','🖼️','🪞','🪟','🛍️','🛒','🎁','🎈','🎏','🎀','🪄','🪅','🎊','🎉','🎎','🏮','🎐','🧧','✉️','📩','📨','📧','📤','📥','📦','📫','📪','📬','📭','📮','🗳️','✏️','✒️','🖋️','🖊️','🖌️','🖍️','📝','💼','📁','📂','🗂️','📅','📆','🗒️','🗓️','📇','📈','📉','📊','📋','📌','📍','📎','🖇️','📏','📐','✂️','🗃️','🗄️','🗑️','🔒','🔓','🔏','🔐','🔑','🗝️'],
            'symbols': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂','🛂','🛃','🛄','🛅','🛗','🚹','🚺','🚼','⚧️','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','⬛','⬜','🟥','🟧','🟨','🟩','🟦','🟪','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🀄','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛','🕜','🕝','🕞','🕟','🕠','🕡','🕢','🕣','🕤','🕥','🕦','🕧']
        };

        function renderEmojis(category, filter) {
            const grid = document.getElementById('emojiGrid');
            grid.innerHTML = '';
            
            let emojis = [];
            
            if (category === 'recent') {
                emojis = window.getRecentEmojis ? window.getRecentEmojis() : [];
                if (emojis.length === 0) {
                    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted);font-size:14px;">Недавние эмодзи появятся здесь</div>';
                    return;
                }
            } else {
                // Используем window.EmojiData если есть, иначе DEFAULT_EMOJIS
                emojis = (window.EmojiData && window.EmojiData[category]) 
                    ? window.EmojiData[category] 
                    : (DEFAULT_EMOJIS[category] || []);
            }
            
            if (filter) {
                emojis = emojis.filter(function(e) { return e.indexOf(filter) >= 0; });
            }
            
            emojis.forEach(function(emoji) {
                const item = document.createElement('div');
                item.className = 'emoji-item';
                item.textContent = emoji;
                item.onmousedown = function(e) { e.preventDefault(); };
                item.onclick = function() { insertEmoji(emoji); };
                grid.appendChild(item);
            });
        }

        function filterEmojis(query) {
            if (!query) {
                renderEmojis(currentEmojiCategory);
                return;
            }

            const grid = document.getElementById('emojiGrid');
            grid.innerHTML = '';

            const allCategories = ['smileys', 'animals', 'food', 'activities', 'travel', 'objects', 'symbols'];
            let allEmojis = [];

            allCategories.forEach(function(cat) {
                if (window.EmojiData && window.EmojiData[cat]) {
                    allEmojis = allEmojis.concat(window.EmojiData[cat]);
                }
            });

            allEmojis = [...new Set(allEmojis)];

            // Фильтруем эмодзи по запросу
            const filtered = allEmojis.filter(function(emoji) {
                return emoji.includes(query);
            });

            filtered.forEach(function(emoji) {
                const item = document.createElement('div');
                item.className = 'emoji-item';
                item.textContent = emoji;
                item.onmousedown = function(e) { e.preventDefault(); };
                item.onclick = function() { insertEmoji(emoji); };
                grid.appendChild(item);
            });
        }

        function insertEmoji(emoji) {
            const input = document.getElementById('msgInput');
            input.focus();
            document.execCommand('insertText', false, emoji);
            
            if (window.addToRecent) {
                window.addToRecent(emoji);
            }
        }

        // ============================================
        // TEXT FORMATTING IN INPUT
        // ============================================
        function formatInputText(format) {
            const input = document.getElementById('msgInput');
            const selection = window.getSelection();

            if (!selection || selection.rangeCount === 0) {
                return;
            }

            const selectedText = selection.toString();
            const collapsed = selection.isCollapsed;

            if (format === 'quote') {
                if (collapsed) {
                    document.execCommand('insertText', false, '> ');
                } else {
                    document.execCommand('insertText', false, selectedText.split('\n').map(function(line) {
                        return '> ' + line;
                    }).join('\n'));
                }
                input.focus();
                return;
            }

            if (collapsed) {
                showToast('info', tr('selectTextToFormat', 'Выделите текст для форматирования'), '✏️');
                return;
            }

            let prefix = '';
            let suffix = '';
            switch (format) {
                case 'bold': prefix = '**'; suffix = '**'; break;
                case 'italic': prefix = '_'; suffix = '_'; break;
                case 'underline': prefix = '__'; suffix = '__'; break;
                case 'strikethrough': prefix = '~~'; suffix = '~~'; break;
                case 'monospace': prefix = '`'; suffix = '`'; break;
                case 'spoiler': prefix = '||'; suffix = '||'; break;
                default: return;
            }

            document.execCommand('insertText', false, prefix + selectedText + suffix);
            input.focus();
        }
        window.formatInputText = formatInputText;

        // Горячие клавиши, Enter и навигация по подсказкам @
        document.getElementById('msgInput').addEventListener('keydown', function(e) {
            if (mentionSuggestionsList.length) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    mentionSuggestionIndex = (mentionSuggestionIndex + 1) % mentionSuggestionsList.length;
                    highlightMentionSuggestion(mentionSuggestionIndex);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    mentionSuggestionIndex = (mentionSuggestionIndex - 1 + mentionSuggestionsList.length) % mentionSuggestionsList.length;
                    highlightMentionSuggestion(mentionSuggestionIndex);
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    selectActiveMentionSuggestion();
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    hideMentionSuggestions();
                    return;
                }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
                return;
            }
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'b') {
                    e.preventDefault();
                    formatInputText('bold');
                } else if (e.key === 'i') {
                    e.preventDefault();
                    formatInputText('italic');
                }
            }
        });

        // Контекстное меню для форматирования текста в поле ввода
        const msgInput = document.getElementById('msgInput');
        const inputContextMenu = document.getElementById('inputContextMenu');

        msgInput.addEventListener('contextmenu', function(e) {
            const selection = window.getSelection();
            
            // Показываем меню только если есть выделение
            if (selection && !selection.isCollapsed && selection.toString().length > 0) {
                e.preventDefault();
                
                const x = e.pageX || e.clientX || 0;
                const y = e.pageY || e.clientY || 0;
                
                inputContextMenu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
                inputContextMenu.style.top = Math.min(y, window.innerHeight - 150) + 'px';
                inputContextMenu.classList.add('active');
            }
        });

        // Закрыть контекстное меню при клике вне его
        document.addEventListener('click', function(e) {
            if (!e.target.closest('#inputContextMenu') && !e.target.closest('#msgInput')) {
                inputContextMenu.classList.remove('active');
            }
        });

        document.addEventListener('click', function(e) {
            const picker = document.getElementById('emojiPicker');
            const btn = document.getElementById('emojiBtn');
            
            if (picker.classList.contains('active')) {
                if (!picker.contains(e.target) && !btn.contains(e.target)) {
                    closeEmojiPicker();
                }
            }

            const mentionEl = document.getElementById('mentionSuggestions');
            const msgInputWrap = document.getElementById('msgInputWrap');
            if (mentionEl && mentionEl.style.display !== 'none') {
                if (!mentionEl.contains(e.target) && !(msgInputWrap && msgInputWrap.contains(e.target))) {
                    hideMentionSuggestions();
                }
            }
        });

        // ============================================
        // STICKER PACKS
        // ============================================
        async function loadStickerPacks() {
            try {
                const res = await fetch('/api/v1/stickers/packs', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error('Failed to load sticker packs');
                const data = await res.json();
                stickerPacks = data.packs.map(p => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    icon: p.iconUrl || '🎨',
                    stickers: [],
                    stickerIds: [],
                    isCommon: false
                }));

                // Загружаем стикеры для каждого пака
                for (const pack of stickerPacks) {
                    const stickersRes = await fetch('/api/v1/stickers/packs/' + pack.id, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    if (stickersRes.ok) {
                        const stickersData = await stickersRes.json();
                        pack.stickers = stickersData.stickers.map(s => s.imageUrl);
                        pack.stickerIds = stickersData.stickers.map(s => s.id);
                    }
                }

                renderStickerPacksList();
            } catch (error) {
                console.error('Load sticker packs error:', error);
                // Fallback к localStorage если сервер недоступен
                const stored = localStorage.getItem('craneapp_sticker_packs');
                stickerPacks = stored ? JSON.parse(stored) : [];
                renderStickerPacksList();
            }
        }

        async function saveStickerPacks() {
            // Сохранение происходит на сервере через API
            // localStorage больше не используется
        }

        function renderStickerPacksList() {
            const container = document.getElementById('stickerPacks');
            container.innerHTML = '';

            // Кнопка создания нового пак
            const addBtn = document.createElement('div');
            addBtn.className = 'sticker-pack-item sticker-pack-add';
            addBtn.onclick = openCreatePackModal;
            addBtn.innerHTML = '<div class="sticker-pack-icon sticker-pack-add">➕</div><span class="sticker-pack-name">Новый</span>';
            container.appendChild(addBtn);

            // Рендерим все паки (теперь только личные)
            stickerPacks.forEach(function(pack, index) {
                const realIndex = index + 1; // +1 из-за кнопки создания
                const item = document.createElement('div');
                item.className = 'sticker-pack-item' + (currentStickerPackId === realIndex ? ' active' : '');
                item.onclick = function() { selectStickerPack(realIndex); };
                // Аватар - последний стикер или иконка
                const avatar = pack.stickers && pack.stickers.length > 0 ? pack.stickers[pack.stickers.length - 1] : (pack.icon || '🎨');
                item.innerHTML = '<div class="sticker-pack-icon"><img src="' + avatar + '" alt=""></div><span class="sticker-pack-name">' + escapeHtml(pack.name) + '</span>';
                container.appendChild(item);
            });

            if (stickerPacks.length > 0 && currentStickerPackId === null) {
                selectStickerPack(1);
            } else if (stickerPacks.length === 0) {
                currentStickerPackId = null;
                renderStickerGrid();
            }
        }

        function selectStickerPack(index) {
            currentStickerPackId = index;
            document.querySelectorAll('.sticker-pack-item').forEach(function(el, i) {
                el.classList.toggle('active', i === index + 1);
            });
            renderStickerGrid();
        }

        function renderStickerGrid() {
            const grid = document.getElementById('stickerGrid');
            grid.innerHTML = '';
            
            if (currentStickerPackId === null || !stickerPacks[currentStickerPackId]) {
                grid.innerHTML = '<div class="sticker-empty">Выберите или создайте стикерпак</div>';
                return;
            }
            
            const pack = stickerPacks[currentStickerPackId];
            
            const addBtn = document.createElement('div');
            addBtn.className = 'sticker-item sticker-add-btn';
            addBtn.textContent = '➕';
            addBtn.onclick = addStickerToPack;
            grid.appendChild(addBtn);
            
            if (pack.stickers && pack.stickers.length > 0) {
                pack.stickers.forEach(function(stickerUrl) {
                    const item = document.createElement('div');
                    item.className = 'sticker-item';
                    item.innerHTML = '<img src="' + stickerUrl + '" alt="">';
                    item.onclick = function() { sendStickerMessage(stickerUrl); };
                    grid.appendChild(item);
                });
            }
        }

        function addStickerToPack() {
            if (currentStickerPackId === null) {
                showToast('error', 'Выберите стикерпак', '❌');
                return;
            }
            document.getElementById('stickerInput').click();
        }

        async function addStickerToCurrentPack(stickerData) {
            if (currentStickerPackId === null || !stickerPacks[currentStickerPackId]) {
                showToast('error', 'Выберите стикерпак', '❌');
                return;
            }

            const pack = stickerPacks[currentStickerPackId];

            // Общие паки нельзя редактировать
            if (pack.isCommon) {
                showToast('error', 'Нельзя редактировать общие паки', '❌');
                return;
            }

            try {
                const res = await fetch('/api/v1/stickers/packs/' + pack.id, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({
                        image: stickerData
                    })
                });

                if (!res.ok) throw new Error('Failed to add sticker');

                const data = await res.json();
                if (!pack.stickers) {
                    pack.stickers = [];
                }
                if (!pack.stickerIds) {
                    pack.stickerIds = [];
                }
                pack.stickers.push(data.sticker.imageUrl);
                pack.stickerIds.push(data.sticker.id);
                renderStickerGrid();
                // Обновляем и эмодзи-пикер если открыт
                if (emojiCurrentPackIdx === currentStickerPackId) emojiRenderStickerGrid();
                showToast('success', 'Стикер добавлен', '✓');
            } catch (error) {
                console.error('Add sticker error:', error);
                showToast('error', 'Ошибка добавления стикера', '❌');
            }
        }

        async function createStickerPack() {
            const name = document.getElementById('newPackName').value.trim();
            const desc = document.getElementById('newPackDesc').value.trim();

            if (!name) {
                showToast('error', 'Введите название', '❌');
                return;
            }

            try {
                const res = await fetch('/api/v1/stickers/packs', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({
                        name: name,
                        description: desc,
                        icon: newPackIconData
                    })
                });

                if (!res.ok) throw new Error('Failed to create sticker pack');

                const data = await res.json();
                const newPack = {
                    id: data.pack.id,
                    name: data.pack.name,
                    description: data.pack.description,
                    icon: data.pack.iconUrl || '🎨',
                    stickers: [],
                    isCommon: false
                };

                stickerPacks.push(newPack);

                closeCreatePackModal();
                renderStickerPacksList();
                selectStickerPack(stickerPacks.length - 1);
                // Обновляем эмодзи-пикер
                emojiCurrentPackIdx = stickerPacks.length - 1;
                emojiRenderPacksList();
                showToast('success', 'Стикерпак создан', '✓');
            } catch (error) {
                console.error('Create sticker pack error:', error);
                showToast('error', 'Ошибка создания пака', '❌');
            }
        }

        // ============================================
        // GIF STORAGE
        // ============================================
        // Старая функция loadGifs удалена - используется новая async function loadGifs(query) выше

        async function saveGif(gifUrl, name) {
            try {
                const res = await fetch('/api/v1/gifs', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({
                        name: name || '',
                        url: gifUrl
                    })
                });

                if (res.ok) {
                    const grid = document.getElementById('emojiGifGrid');
                    if (grid) loadGifs('');
                }
            } catch (error) {
                showToast('error', 'Ошибка сохранения', '❌');
            }
        }

        // ============================================
        // WEBSOCKET
        // ============================================
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = protocol + '//' + window.location.host + '/ws?userId=' + user.id;
            window._chatWsConnected = true; // сигнал для notifications.js
            
            try {
                ws = new WebSocket(wsUrl);
                window.craneWs = ws;
            } catch (e) {
                console.error('WebSocket error:', e);
                scheduleReconnect();
                return;
            }
            
            ws.onopen = function() {
                console.log('✅ WebSocket connected');
                if (wsReconnectTimer) {
                    clearTimeout(wsReconnectTimer);
                    wsReconnectTimer = null;
                }
                // Keepalive: пинг каждые 20 сек чтобы NAT мобильных операторов не дропал соединение
                if (ws._pingInterval) clearInterval(ws._pingInterval);
                ws._pingInterval = setInterval(function() {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, 20000);
            };
            
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    handleWsMessage(data);
                } catch (e) {
                    console.error('WS parse error:', e);
                }
            };
            
            ws.onclose = function() {
                console.log('❌ WebSocket disconnected');
                if (ws._pingInterval) { clearInterval(ws._pingInterval); ws._pingInterval = null; }
                scheduleReconnect();
            };
            
            ws.onerror = function(err) {
                console.error('WS error:', err);
            };
        }
        
        function scheduleReconnect() {
            if (wsReconnectTimer) return;
            wsReconnectTimer = setTimeout(function() {
                connectWebSocket();
            }, 3000);
        }

        function handleWsMessage(data) {
            // Перехват входящего видеозвонка
            if (data && data.type === 'call_incoming') {
                if (window.__handleIncomingCallMessage) window.__handleIncomingCallMessage(data);
                return;
            }
            if (data && data.type === 'call_cancelled') {
                // Звонящий отменил вызов до ответа — убираем баннер входящего звонка
                if (_incomingCall && _incomingCall.roomId === data.roomId) {
                    try { _stopRingtone(); } catch(_){}
                    _hideIncomingCallBanner();
                    _incomingCall = null;
                }
                return;
            }
            if (data && data.type === 'call_invite_response') {
                if (window._cancelCallInviteRetry) { window._cancelCallInviteRetry(); window._cancelCallInviteRetry = null; }
                if (data.accepted) {
                    try { showToast && showToast('success', tr('callAccepted', 'Собеседник принял звонок')); } catch(_){}
                } else {
                    try { showToast && showToast('info', tr('callDeclined', 'Собеседник отклонил звонок')); } catch(_){}
                    // Закрываем окно звонка через postMessage в iframe
                    try { document.getElementById('callFrame').contentWindow.postMessage({ type: 'crane_hangup' }, '*'); } catch(_) {}
                }
                return;
            }
            switch (data.type) {
                case 'connected':
                    console.log('WS session:', data.userId);
                    break;

                case 'settings_updated':
                    if (window.syncThemeWithServer) window.syncThemeWithServer();
                    break;

                case 'channel_comment':
                    if (activeChat && data.chatId === activeChat.id && data.comment) {
                        const commentMsg = Object.assign({}, data.comment, {
                            parentMessageId: data.postId || data.comment.parentMessageId
                        });
                        const parentId = data.postId || commentMsg.parentMessageId;
                        addMessage(commentMsg);
                        if (parentId && isCommentThreadActive() && commentThreadPostId === parentId) {
                            bumpPostCommentCount(parentId, data.comment);
                        }
                    } else if (data.postId && typeof window.updatePostCommentCount === 'function') {
                        const post = messagesData[data.postId];
                        const nextCount = (post?.commentCount || 0) + 1;
                        if (post) post.commentCount = nextCount;
                        if (data.comment && typeof window.appendPostCommentPreview === 'function') {
                            window.appendPostCommentPreview(data.postId, data.comment);
                        } else {
                            window.updatePostCommentCount(data.postId, nextCount);
                        }
                    }
                    break;
                    
                case 'new_message':
                    if (activeChat && data.chatId === activeChat.id) {
                        // Расшифровываем если нужно
                        const decryptMsg = async (msg) => {
                            if (msg.isEncrypted && msg.encryptionIv && window.E2E) {
                                try {
                                    const decrypted = await window.E2E.decrypt(msg.content, msg.encryptionIv, activeChat.id, token);
                                    if (decrypted === '🔒 [зашифровано]' && msg.contentPlain) {
                                        msg.content = msg.contentPlain;
                                    } else {
                                        msg.content = decrypted;
                                    }
                                    msg._isDecrypted = true;
                                } catch (_) {}
                            }
                            if (msg.replyToEncrypted && msg.replyToIv && window.E2E) {
                                try {
                                    const decryptedReply = await window.E2E.decrypt(msg.replyToContent, msg.replyToIv, activeChat.id, token);
                                    if (decryptedReply !== '🔒 [зашифровано]') {
                                        msg.replyToContent = decryptedReply;
                                    }
                                } catch (_) {}
                            }
                            // replyToData из WS (при отправке нового сообщения)
                            if (msg.replyToData?.isEncrypted && msg.replyToData?.encryptionIv && window.E2E) {
                                try {
                                    const decryptedReplyData = await window.E2E.decrypt(msg.replyToData.content, msg.replyToData.encryptionIv, activeChat.id, token);
                                    if (decryptedReplyData !== '🔒 [зашифровано]') {
                                        msg.replyToData.content = decryptedReplyData;
                                    }
                                } catch (_) {}
                            }
                            return msg;
                        };
                        decryptMsg(data.message).then(msg => {
                            notifyIfMentioned(msg, data.chatId, data.chatTitle);
                            addMessage(msg);
                            markChatAsRead(data.chatId, { silent: true }).catch(function(err) {
                                console.error('Mark chat as read error:', err);
                            });
                        });
                    } else if (data.message && data.message.mentionedUserIds && data.message.mentionedUserIds.includes(user.id)) {
                        notifyIfMentioned(data.message, data.chatId, data.chatTitle);
                    }
                    // Если чат новый (нас нет в chatUsers) — добавляем его сразу
                    if (data.chatId && !allChats.find(c => c.id === data.chatId)) {
                        const msg = data.message;
                        const senderName = msg.senderFirstName || msg.sender?.firstName || msg.senderName || 'Пользователь';
                        const senderAv = msg.senderAvatar || msg.sender?.avatarUrl || senderName[0];
                        const senderId = msg.senderId || msg.sender?.id;
                        if (senderId && senderId !== user.id) {
                            chatUsers[data.chatId] = { id: senderId, name: senderName, av: senderAv, isOnline: false };
                        }
                        allChats.unshift({
                            id: data.chatId, name: senderName, av: senderAv,
                            lastMessage: formatLastMessageFromMessage(msg),
                            lastMessageAt: new Date().toISOString(),
                            time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                            isOnline: false, isPinned: false, lastMessageType: msg.type || 'text',
                            lastMessageSenderId: msg.sender_id || msg.senderId || msg.sender?.id,
                            type: data.chatType || 'private',
                            mentionCount: Array.isArray(msg.mentionedUserIds) && msg.mentionedUserIds.includes(user.id) ? 1 : 0,
                            latestMentionAt: Array.isArray(msg.mentionedUserIds) && msg.mentionedUserIds.includes(user.id) ? (msg.createdAt || msg.created_at || new Date().toISOString()) : null,
                            oldestMentionMessageId: Array.isArray(msg.mentionedUserIds) && msg.mentionedUserIds.includes(user.id) ? (msg.id || null) : null
                        });
                        renderChatList();
                    } else {
                        // Обновляем время последнего сообщения для существующего чата
                        const existingChat = allChats.find(c => c.id === data.chatId);
                        if (existingChat) {
                            existingChat.lastMessageAt = new Date().toISOString();
                            existingChat.time = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                            existingChat.lastMessageType = data.message?.type || existingChat.lastMessageType || 'text';
                            existingChat.lastMessageSenderId = data.message?.sender_id || data.message?.senderId || data.message?.sender?.id;
                            existingChat.lastMessage = formatLastMessageFromMessage(data.message, existingChat.lastMessage);
                        }
                        loadChats();
                    }
                    
                    // Показываем уведомление для новых сообщений
                    if (!activeChat || activeChat.id !== data.chatId || !document.hasFocus()) {
                        const chatInfo = allChats.find(c => c.id === data.chatId) || {
                            id: data.chatId,
                            name: data.message.senderFirstName || 'Пользователь',
                            type: 'private'
                        };
                        notifyNewMessage(data.message, chatInfo);
                    }
                    break;
                    
                case 'poll_updated':
                    if (activeChat && data.chatId === activeChat.id && data.messageId) {
                        refreshPollFromServer(data.messageId);
                    }
                    break;

                case 'message_edited':
                    updateMessage(data.messageId, data.content);
                    break;
                    
                case 'message_deleted':
                    removeMessage(data.messageId);
                    break;
                    
                case 'message_pinned':
                    if (activeChat && data.chatId === activeChat.id) {
                        if (messagesData[data.message.id]) {
                            messagesData[data.message.id].isPinned = true;
                        }
                        // Добавляем в массив закрепленных (в начало — самое свежее)
                        if (!pinnedMessages.find(m => m.id === data.message.id)) {
                            pinnedMessages.unshift(data.message);
                        }
                        currentPinnedIndex = 0;
                        showPinnedMessage(pinnedMessages[0]);
                        const msgEl = document.querySelector('[data-message-id="' + data.message.id + '"]');
                        if (msgEl) msgEl.classList.add('pinned');
                    }
                    break;
                    
                case 'message_unpinned':
                    if (activeChat && data.chatId === activeChat.id) {
                        if (messagesData[data.messageId]) {
                            messagesData[data.messageId].isPinned = false;
                        }
                        pinnedMessages = pinnedMessages.filter(m => m.id !== data.messageId);
                        const msgEl = document.querySelector('[data-message-id="' + data.messageId + '"]');
                        if (msgEl) msgEl.classList.remove('pinned');
                        if (pinnedMessages.length === 0) {
                            currentPinnedIndex = 0;
                            hidePinnedMessage();
                        } else {
                            if (currentPinnedIndex >= pinnedMessages.length) currentPinnedIndex = 0;
                            showPinnedMessage(pinnedMessages[currentPinnedIndex]);
                        }
                    }
                    break;
                    
                case 'user_typing':
                    if (activeChat && data.chatId === activeChat.id) {
                        showTyping();
                    }
                    break;
                    
                case 'user_status':
                    // Обновляем кэш chatUsers для всех чатов где есть этот пользователь
                    Object.keys(chatUsers).forEach(cid => {
                        if (chatUsers[cid].id === data.userId) {
                            chatUsers[cid].isOnline = data.isOnline;
                            chatUsers[cid].lastSeen = data.lastSeen || chatUsers[cid].lastSeen;
                        }
                    });
                    // Обновляем хедер если открыт чат с этим пользователем
                    if (activeChat && chatUsers[activeChat.id] && chatUsers[activeChat.id].id === data.userId) {
                        const statusEl = document.getElementById('chatStatus');
                        if (statusEl) {
                            statusEl.textContent = chatStatusText({ isOnline: data.isOnline, lastSeen: data.lastSeen });
                            statusEl.style.color = data.isOnline ? 'var(--success-color)' : 'var(--text-muted)';
                        }
                    }
                    // Обновляем список чатов без полной перезагрузки
                    renderChatList();
                    break;

                case 'new_chat':
                    // Новый чат создан — добавляем в список если нас нет
                    if (data.chatId && !allChats.find(c => c.id === data.chatId)) {
                        const name = data.senderName || data.title || 'Чат';
                        const av = data.senderAvatar || name[0];
                        if (data.senderId) {
                            chatUsers[data.chatId] = { id: data.senderId, name, av, isOnline: false };
                        }
                        allChats.unshift({
                            id: data.chatId, name, av,
                            lastMessage: '', time: '',
                            isOnline: false, isPinned: false,
                            lastMessageType: 'text'
                        });
                        renderChatList();
                    }
                    break;

                case 'member_joined':
                    if (activeChat && data.chatId === activeChat.id) {
                        if (data.message) addMessage(data.message);
                        loadGroupMembersForMentions(activeChat.id);
                        // Если открыта инфа группы, обновим её
                        const modal = document.getElementById('groupInfoModal');
                        if (modal && modal.style.display === 'flex') {
                            openGroupInfoModal(activeChat.id);
                        }
                    }
                    loadChats();
                    break;

                case 'member_left':
                    if (data.userId === user.id) {
                        if (activeChat && data.chatId === activeChat.id) {
                            closeChat();
                        }
                        showToast('info', 'Вы вышли из группы или были исключены', 'ℹ️');
                    } else {
                        if (activeChat && data.chatId === activeChat.id) {
                            if (data.message) addMessage(data.message);
                            loadGroupMembersForMentions(activeChat.id);
                            // Если открыта инфа группы, обновим её
                            const modal = document.getElementById('groupInfoModal');
                            if (modal && modal.style.display === 'flex') {
                                openGroupInfoModal(activeChat.id);
                            }
                        }
                    }
                    loadChats();
                    break;

                case 'reaction_updated':
                    updateMessageReactions(data.messageId, data.reactions);
                    break;
            }
        }

        // ============================================
        // BROWSER NOTIFICATIONS
        // ============================================
        let notificationPermission = 'default';
        let notificationSettings = {
            desktop: true,
            sound: true,
            preview: true
        };

        // Инициализация уведомлений
        async function initNotifications() {
            if (!('Notification' in window)) {
                console.log('Браузер не поддерживает уведомления');
                return;
            }

            // Загружаем настройки
            const saved = localStorage.getItem('craneapp_notification_settings');
            if (saved) {
                notificationSettings = JSON.parse(saved);
            }

            // Проверяем текущий статус разрешений
            notificationPermission = Notification.permission;
            
            // Если разрешение еще не запрошено, запрашиваем при первом сообщении
            if (notificationPermission === 'default') {
                await requestNotificationPermission();
            }
        }

        // Запрос разрешения на уведомления
        async function requestNotificationPermission() {
            if (!('Notification' in window)) return false;
            
            try {
                const permission = await Notification.requestPermission();
                notificationPermission = permission;
                
                if (permission === 'granted') {
                    showToast('success', 'Уведомления включены! 🔔', '✅');
                    return true;
                } else if (permission === 'denied') {
                    showToast('error', 'Уведомления отключены в настройках браузера', '❌');
                    return false;
                }
            } catch (error) {
                console.error('Ошибка запроса разрешений:', error);
            }
            return false;
        }

        // Показать браузерное уведомление
        function showBrowserNotification(title, options = {}) {
            if (!('Notification' in window)) return;
            if (notificationPermission !== 'granted') return;
            if (!notificationSettings.desktop) return;

            const defaultOptions = {
                icon: '/logo.png',
                badge: '/logo.png',
                tag: 'craneapp-message',
                requireInteraction: false,
                silent: !notificationSettings.sound
            };

            const notificationOptions = { ...defaultOptions, ...options };

            try {
                const notification = new Notification(title, notificationOptions);
                
                // Автоматически закрываем через 5 секунд
                setTimeout(() => {
                    notification.close();
                }, 5000);

                // Обработка клика по уведомлению
                notification.onclick = function() {
                    window.focus();
                    notification.close();
                    
                    // Если есть chatId, открываем соответствующий чат
                    if (options.data && options.data.chatId) {
                        openChat(options.data.chatId, options.data.chatName);
                    }
                };

                return notification;
            } catch (error) {
                console.error('Ошибка показа уведомления:', error);
            }
        }

        // Уведомление о новом сообщении
        function notifyNewMessage(message, chatInfo) {
            // Не показываем уведомление если:
            // 1. Чат активен и страница в фокусе
            // 2. Отправитель - текущий пользователь
            // 3. Уведомления отключены
            
            if (activeChat && activeChat.id === chatInfo.id && document.hasFocus()) {
                return;
            }
            
            if (message.senderId === user.id) {
                return;
            }

            if (!notificationSettings.desktop) {
                return;
            }

            // Запрашиваем разрешение если еще не получено
            if (notificationPermission === 'default') {
                requestNotificationPermission().then(granted => {
                    if (granted) {
                        showNotificationNow(message, chatInfo);
                    }
                });
            } else if (notificationPermission === 'granted') {
                showNotificationNow(message, chatInfo);
            }
        }

        // Показать уведомление прямо сейчас
        function showNotificationNow(message, chatInfo) {
            const senderName = message.senderFirstName || message.sender?.firstName || message.senderName || 'Пользователь';
            let title = senderName;
            let body = '';
            let icon = '/logo.png';

            // Для групповых чатов добавляем имя чата
            if (chatInfo.type === 'group' || chatInfo.type === 'channel') {
                title = `${chatInfo.name} • ${senderName}`;
            }

            // Определяем содержимое уведомления в зависимости от типа сообщения
            if (message.type === 'text' || !message.type) {
                body = message.content || message.text || '';
                if (body.length > 100) {
                    body = body.substring(0, 100) + '...';
                }
            } else if (message.type === 'image' || message.type === 'photo') {
                body = '📷 Фото';
                if (message.mediaUrl) {
                    icon = message.mediaUrl;
                }
            } else if (message.type === 'video') {
                body = '🎬 Видео';
            } else if (message.type === 'sticker') {
                body = '🎨 Стикер';
                if (message.mediaUrl) {
                    icon = message.mediaUrl;
                }
            } else if (message.type === 'poll') {
                body = '📊 ' + (message.poll?.question || message.content || tr('pollMessage', 'Опрос'));
            } else if (message.type === 'gif') {
                body = '🎬 GIF';
                if (message.mediaUrl) {
                    icon = message.mediaUrl;
                }
            } else if (message.type === 'file') {
                body = '📎 Файл';
            } else {
                body = message.content || 'Новое сообщение';
            }

            // Показываем уведомление
            showBrowserNotification(title, {
                body: body,
                icon: icon,
                tag: `chat-${chatInfo.id}`,
                data: {
                    chatId: chatInfo.id,
                    chatName: chatInfo.name,
                    messageId: message.id
                },
                requireInteraction: message.type === 'call'
            });
        }

        // Обновление настроек уведомлений
        function updateNotificationSettings(settings) {
            notificationSettings = { ...notificationSettings, ...settings };
            localStorage.setItem('craneapp_notification_settings', JSON.stringify(notificationSettings));
        }
        
        function addMessage(msg) {
            const parentId = msg.parentMessageId || msg.parent_message_id || null;
            if (parentId) {
                if (!isCommentThreadActive() || commentThreadPostId !== parentId) {
                    bumpPostCommentCount(parentId, msg);
                    return;
                }
            } else if (isCommentThreadActive()) {
                return;
            }

            messagesData[msg.id] = msg;
            const messagesEl = getActiveMessagesEl();
            if (!messagesEl) return;
            const emptyState = messagesEl.querySelector('.channel-comments-state');
            if (emptyState) emptyState.remove();
            const div = createMessageElement(msg);
            messagesEl.appendChild(div);
            const senderId = msg.senderId || msg.sender_id || (msg.sender && msg.sender.id);
            if (isMessagesNearBottom()) {
                scrollToBottom(false);
            } else if (senderId === user.id) {
                scrollToBottom(true);
            } else {
                updateScrollButton();
            }
            updateMentionJumpButton();
        }
        
        function updateMessage(messageId, content) {
            const el = document.querySelector('[data-message-id="' + messageId + '"]');
            if (el) {
                const textEl = el.querySelector('.message-text');
                if (textEl) textEl.textContent = content;
            }
        }
        
        function removeMessage(messageId) {
            const el = document.querySelector('[data-message-id="' + messageId + '"]');
            if (el) el.remove();
            delete messagesData[messageId];
            // Удаляем из массива закрепленных
            const wasPinned = pinnedMessages.some(m => m.id === messageId);
            if (wasPinned) {
                pinnedMessages = pinnedMessages.filter(m => m.id !== messageId);
                if (pinnedMessages.length === 0) {
                    currentPinnedIndex = 0;
                    hidePinnedMessage();
                } else {
                    if (currentPinnedIndex >= pinnedMessages.length) currentPinnedIndex = 0;
                    showPinnedMessage(pinnedMessages[currentPinnedIndex]);
                }
            }
        }
        
        function showTyping() {
            const statusEl = document.getElementById('chatStatus');
            if (!statusEl) return;
            statusEl.textContent = tr('typing', 'typing...');
            statusEl.style.color = 'var(--success-color)';
            clearTimeout(showTyping._t);
            showTyping._t = setTimeout(function() {
                if (activeChat && chatUsers[activeChat.id]) {
                    const u = chatUsers[activeChat.id];
                    statusEl.textContent = chatStatusText(u);
                    statusEl.style.color = (u.isOnline || u.online) ? 'var(--success-color)' : 'var(--text-muted)';
                } else {
                    statusEl.textContent = tr('online', 'online');
                }
            }, 3000);
        }

        function sendTyping() {
            if (ws && ws.readyState === WebSocket.OPEN && activeChat) {
                ws.send(JSON.stringify({
                    type: 'typing',
                    chatId: activeChat.id
                }));
            }
        }

        // ============================================
        // SYNC USER DATA
        // ============================================
        async function syncUserData() {
            try {
                const res = await fetch('/api/v1/users/me', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                
                if (data.user) {
                    user = {
                        id: data.user.id,
                        username: data.user.username,
                        firstName: data.user.firstName,
                        lastName: data.user.lastName,
                        avatarUrl: data.user.avatarUrl,
                        bio: data.user.bio,
                        badge: data.user.badge || null,
                        badges: data.user.badges || [],
                        isBot: data.user.isBot || false,
                        isPremium: data.user.isPremium || data.user.is_premium || false
                    };
                    localStorage.setItem('craneapp_user_data', JSON.stringify(user));
                    updateSideMenuProfile();
                    console.log('✅ User data synced');
                }
            } catch (e) {
                console.warn('⚠️ User sync failed:', e);
            }
        }

        // ============================================
        // SCROLL TO BOTTOM
        // ============================================
        const SCROLL_BOTTOM_THRESHOLD = 48;
        let scrollBottomLastMsgObserver = null;

        function isMessagesNearBottom(threshold) {
            const container = document.getElementById('messagesContainer');
            if (!container) return true;
            const t = threshold == null ? SCROLL_BOTTOM_THRESHOLD : threshold;
            return container.scrollHeight - container.scrollTop - container.clientHeight < t;
        }

        function getLastMessageElement() {
            const messagesEl = document.getElementById('messages');
            if (!messagesEl) return null;
            const items = messagesEl.querySelectorAll('.message[data-message-id]');
            return items.length ? items[items.length - 1] : null;
        }

        function disconnectScrollBottomObserver() {
            if (scrollBottomLastMsgObserver) {
                scrollBottomLastMsgObserver.disconnect();
                scrollBottomLastMsgObserver = null;
            }
        }

        function syncScrollBottomButtonVisible(isLastVisible) {
            const btn = document.getElementById('scrollBottomBtn');
            if (!btn || !btn.classList.contains('enabled')) return;
            btn.classList.toggle('visible', !isLastVisible);
        }

        function updateScrollButtonFallback() {
            const container = document.getElementById('messagesContainer');
            const btn = document.getElementById('scrollBottomBtn');
            if (!container || !btn || !btn.classList.contains('enabled')) return;
            const lastEl = getLastMessageElement();
            if (!lastEl) {
                btn.classList.remove('visible');
                return;
            }
            const cRect = container.getBoundingClientRect();
            const rect = lastEl.getBoundingClientRect();
            const visibleHeight = Math.min(rect.bottom, cRect.bottom) - Math.max(rect.top, cRect.top);
            const fullyVisible = visibleHeight >= rect.height * 0.98 && rect.height > 0;
            syncScrollBottomButtonVisible(fullyVisible);
        }

        function refreshScrollBottomObserver() {
            disconnectScrollBottomObserver();
            const container = document.getElementById('messagesContainer');
            const btn = document.getElementById('scrollBottomBtn');
            if (!container || !btn || !btn.classList.contains('enabled')) {
                if (btn) btn.classList.remove('visible');
                return;
            }
            const lastEl = getLastMessageElement();
            if (!lastEl) {
                btn.classList.remove('visible');
                return;
            }
            if (typeof IntersectionObserver === 'undefined') {
                updateScrollButtonFallback();
                return;
            }
            scrollBottomLastMsgObserver = new IntersectionObserver(function(entries) {
                const entry = entries[0];
                if (!entry) return;
                syncScrollBottomButtonVisible(entry.intersectionRatio >= 0.98);
            }, {
                root: container,
                threshold: [0, 0.25, 0.5, 0.75, 0.98, 1],
                rootMargin: '0px'
            });
            scrollBottomLastMsgObserver.observe(lastEl);
        }

        function setScrollBottomButtonEnabled(enabled) {
            const btn = document.getElementById('scrollBottomBtn');
            if (!btn) return;
            btn.classList.toggle('enabled', !!enabled);
            if (!enabled) {
                btn.classList.remove('visible');
                disconnectScrollBottomObserver();
            } else {
                refreshScrollBottomObserver();
            }
        }

        function scrollToBottom(smooth) {
            const container = getActiveMessagesContainer();
            if (!container) return;
            if (smooth) {
                container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            } else {
                container.scrollTop = container.scrollHeight;
            }
            requestAnimationFrame(refreshScrollBottomObserver);
        }

        function onScrollBottomClick() {
            scrollToBottom(true);
        }

        function updateScrollButton() {
            refreshScrollBottomObserver();
        }

        (function initScrollBottomButton() {
            const container = document.getElementById('messagesContainer');
            if (!container) return;
            container.addEventListener('scroll', function() {
                if (!mentionJumpMsgObserver) updateMentionJumpButton();
            }, { passive: true });
            if (typeof ResizeObserver !== 'undefined') {
                const messagesEl = document.getElementById('messages');
                if (messagesEl) {
                    let resizeObserverPending = false;
                    new ResizeObserver(function() {
                        if (_messagesLayoutBatchDepth > 0) return;
                        if (resizeObserverPending) return;
                        resizeObserverPending = true;
                        requestAnimationFrame(function() {
                            resizeObserverPending = false;
                            if (_messagesLayoutBatchDepth > 0) return;
                            refreshScrollBottomObserver();
                            updateMentionJumpButton();
                        });
                    }).observe(messagesEl);
                }
            }
        })();

        // ============================================
        // JUMP TO UNREAD MENTION (@)
        // ============================================
        function getMentionWaterlineKey(chatId) {
            return 'crane_mention_seen_' + user.id + '_' + chatId;
        }

        function getMentionWaterline(chatId) {
            return localStorage.getItem(getMentionWaterlineKey(chatId)) || '';
        }

        function getMentionPendingKey(chatId) {
            return 'crane_mention_pending_' + user.id + '_' + chatId;
        }

        function markMentionPending(chatId, createdAt) {
            if (!chatId) return;
            const ts = createdAt ? new Date(createdAt).getTime() : Date.now();
            if (Number.isNaN(ts)) return;
            const iso = new Date(ts).toISOString();
            const key = getMentionPendingKey(chatId);
            const prev = localStorage.getItem(key);
            if (!prev || ts > new Date(prev).getTime()) {
                localStorage.setItem(key, iso);
            }
        }

        function chatHasUnreadMention(chatId) {
            if (!chatId) return false;
            const pending = localStorage.getItem(getMentionPendingKey(chatId));
            if (!pending) return false;
            const pendingTime = new Date(pending).getTime();
            if (Number.isNaN(pendingTime)) return false;
            const waterline = getMentionWaterline(chatId);
            const wlTime = waterline ? new Date(waterline).getTime() : 0;
            return pendingTime > wlTime;
        }

        function syncMentionPendingAfterWaterline(chatId) {
            if (!chatHasUnreadMention(chatId)) {
                localStorage.removeItem(getMentionPendingKey(chatId));
            }
        }

        /** Сбрасывает @ в списке чатов — только по явному действию (кнопка @ или «Пометить прочитанным»). */
        function acknowledgeChatMentionsOnOpen(chatId) {
            if (!chatId) return;
            const entry = allChats.find(function(c) { return c.id === chatId; });
            if (!isGroupChatEntry(entry)) return;
            const pending = localStorage.getItem(getMentionPendingKey(chatId));
            if (!pending) return;
            localStorage.setItem(getMentionWaterlineKey(chatId), pending);
            localStorage.removeItem(getMentionPendingKey(chatId));
        }

        function isGroupChatEntry(chat) {
            return !!(chat && (chat.type === 'group' || chat.isGroup));
        }

        function doesMessageMentionUser(msg, chat) {
            if (!msg || !isGroupChatEntry(chat)) return false;
            const senderId = msg.senderId || msg.sender_id || (msg.sender && msg.sender.id);
            if (senderId === user.id) return false;
            if (Array.isArray(msg.mentionedUserIds) && msg.mentionedUserIds.includes(user.id)) {
                return true;
            }
            const text = msg.contentPlain || msg.content_plain || msg.content || msg.text || '';
            if (!text.includes('@')) return false;
            const myUsername = (user.username || '').toLowerCase();
            const regex = /@([a-zA-Z0-9_]+)/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const tag = match[1].toLowerCase();
                if (tag === 'everyone') return true;
                if (tag === 'here' && currentUserGroupOnline) return true;
                if (tag === myUsername) return true;
            }
            return false;
        }

        function refreshMentionPendingFromLoadedMessages(chatId) {
            // Mentions are server-backed now. Loaded messages are used only for
            // in-chat jump targets, not for reconstructing chat-list badges.
            return chatId;
        }

        /** Восстанавливает @ в списке чатов по последнему сообщению (если есть непрочитанные). */
        function syncMentionPendingFromChatListEntry(chat) {
            if (!chat || !isGroupChatEntry(chat)) return;
            if (!(Number(chat.unreadCount) > 0)) return;
            const at = chat.lastMessageAt;
            if (!at) return;
            const msgTime = new Date(at).getTime();
            if (Number.isNaN(msgTime)) return;
            const wlTime = getMentionWaterline(chat.id) ? new Date(getMentionWaterline(chat.id)).getTime() : 0;
            if (msgTime <= wlTime) return;
            const pseudoMsg = {
                senderId: chat.lastMessageSenderId,
                content: chat.lastMessage || '',
                createdAt: at
            };
            if (!doesMessageMentionUser(pseudoMsg, chat)) return;
            markMentionPending(chat.id, at);
        }

        function syncAllMentionPendingFromChatList() {
            allChats.forEach(syncMentionPendingFromChatListEntry);
        }

        function setMentionWaterline(chatId, createdAt) {
            if (!chatId || !createdAt) return;
            localStorage.setItem(getMentionWaterlineKey(chatId), createdAt);
            syncMentionPendingAfterWaterline(chatId);
            renderChatList();
        }

        function getMessageCreatedTime(m) {
            const raw = m.createdAt || m.created_at;
            return raw ? new Date(raw).getTime() : 0;
        }

        function messageMentionsMe(msg) {
            if (!msg || !activeChat || activeChat.type !== 'group') return false;
            const senderId = msg.senderId || msg.sender_id || (msg.sender && msg.sender.id);
            if (senderId === user.id) return false;

            if (Array.isArray(msg.mentionedUserIds) && msg.mentionedUserIds.includes(user.id)) {
                return true;
            }

            const text = msg.contentPlain || msg.content_plain || msg.content || msg.text || '';
            if (!text.includes('@')) return false;

            const regex = /@([a-zA-Z0-9_]+)/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                if (isMentionRelevantToMe(match[1].toLowerCase())) return true;
            }
            return false;
        }

        function getUnreadMentionMessages() {
            if (!activeChat || activeChat.type !== 'group') return [];
            const chat = allChats.find(function(c) { return c.id === activeChat.id; }) || activeChat;
            const cursor = mentionJumpCursorByChat[activeChat.id];
            return mentionHelpers.getUnreadMentionMessages(messagesData, {
                userId: user.id,
                mentionReadAt: cursor !== undefined ? cursor : (chat.mentionReadAt || activeChat.mentionReadAt || '')
            });
        }

        function getLatestUnreadMentionMessage() {
            const list = getUnreadMentionMessages();
            return list.length ? list[list.length - 1] : null;
        }

        function getOldestUnreadMentionMessage() {
            const list = getUnreadMentionMessages();
            return list.length ? list[0] : null;
        }

        function scrollToUnreadMentionOnOpen() {
            const target = getOldestUnreadMentionMessage();
            if (!target) return false;
            requestAnimationFrame(function() {
                scrollToMentionMessage(target.id, false);
                refreshMentionJumpObserver();
                refreshScrollBottomObserver();
            });
            return true;
        }

        let mentionJumpMsgObserver = null;

        function disconnectMentionJumpObserver() {
            if (mentionJumpMsgObserver) {
                mentionJumpMsgObserver.disconnect();
                mentionJumpMsgObserver = null;
            }
        }

        function syncMentionJumpButtonVisible(isTargetFullyVisible) {
            const btn = document.getElementById('scrollMentionBtn');
            if (!btn || !btn.classList.contains('enabled')) return;
            const hasUnread = !!getOldestUnreadMentionMessage();
            btn.classList.toggle('visible', hasUnread);
        }

        function refreshMentionJumpObserver() {
            disconnectMentionJumpObserver();
            const container = document.getElementById('messagesContainer');
            const btn = document.getElementById('scrollMentionBtn');
            if (!container || !btn || !btn.classList.contains('enabled')) {
                if (btn) btn.classList.remove('visible');
                return;
            }
            const msg = getOldestUnreadMentionMessage();
            if (!msg) {
                btn.classList.remove('visible');
                return;
            }
            const el = document.querySelector('[data-message-id="' + msg.id + '"]');
            if (!el) {
                btn.classList.add('visible');
                return;
            }
            if (typeof IntersectionObserver === 'undefined') {
                const cRect = container.getBoundingClientRect();
                const rect = el.getBoundingClientRect();
                const visibleHeight = Math.min(rect.bottom, cRect.bottom) - Math.max(rect.top, cRect.top);
                const fullyVisible = visibleHeight >= rect.height * 0.98 && rect.height > 0;
                syncMentionJumpButtonVisible(fullyVisible);
                return;
            }
            mentionJumpMsgObserver = new IntersectionObserver(function(entries) {
                const entry = entries[0];
                if (!entry) return;
                syncMentionJumpButtonVisible(entry.intersectionRatio >= 0.98);
            }, {
                root: container,
                threshold: [0, 0.25, 0.5, 0.75, 0.98, 1],
                rootMargin: '0px'
            });
            mentionJumpMsgObserver.observe(el);
        }

        function setMentionJumpButtonEnabled(enabled) {
            const btn = document.getElementById('scrollMentionBtn');
            if (!btn) return;
            const show = !!(enabled && activeChat && activeChat.type === 'group');
            btn.classList.toggle('enabled', show);
            if (!show) {
                btn.classList.remove('visible');
                disconnectMentionJumpObserver();
            } else {
                refreshMentionJumpObserver();
            }
        }

        function updateMentionJumpButton() {
            refreshMentionJumpObserver();
        }

        function scrollToMentionMessage(messageId, smooth) {
            const el = document.querySelector('[data-message-id="' + messageId + '"]');
            if (!el) return false;
            el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
            el.classList.add('highlight');
            setTimeout(function() { el.classList.remove('highlight'); }, 1500);
            updateScrollButton();
            requestAnimationFrame(refreshMentionJumpObserver);
            return true;
        }

        function onMentionJumpClick() {
            const msg = getOldestUnreadMentionMessage();
            if (!msg || !activeChat) return;
            scrollToMentionMessage(msg.id, true);
            mentionJumpCursorByChat[activeChat.id] = mentionHelpers.getMentionCursorAfterJump(
                mentionJumpCursorByChat[activeChat.id],
                msg
            );
            if (!getOldestUnreadMentionMessage()) {
                [allChats, archivedChats].forEach(function(list) {
                    const chat = list.find(c => c.id === activeChat.id);
                    if (chat) Object.assign(chat, mentionHelpers.clearMentionState(chat));
                });
                renderChatList();
            }
            updateMentionJumpButton();
        }

        window.onMentionJumpClick = onMentionJumpClick;

        // ============================================
        // AVATAR
        // ============================================
        function getAvatarGradient(name) {
            return 'linear-gradient(135deg, #FF007F, #9D00FF)';
        }

        function isImage(url) {
            if (!url || typeof url !== 'string') return false;
            // Accept data URLs, absolute URLs, absolute/relative root paths and common uploads path
            return url.startsWith('data:image') || url.startsWith('http') || url.startsWith('/') || url.startsWith('uploads/') || url.startsWith('/uploads/');
        }

        function renderAvatar(url, placeholder, className, username, displayName) {
            className = className || 'avatar';
            // Журавль для бота CraneApp
            if (username === 'craneapp_bot') {
                return '<div class="' + className + '"><img class="avatar-img" src="/logo.png" alt=""></div>';
            }
            if (isImage(url)) {
                return '<div class="' + className + '"><img class="avatar-img" src="' + url + '" alt=""></div>';
            }
            const nameToUse = displayName || placeholder || '?';
            const bg = getAvatarGradient(nameToUse);
            return '<div class="' + className + '" style="background: ' + bg + '"><span>' + (placeholder || '?') + '</span></div>';
        }

        // ============================================
        // REPLY
        // ============================================
        function setReplyTo(messageId, senderName, text) {
            replyingTo = { messageId: messageId, senderName: senderName, text: text };
            document.getElementById('replyBarSender').textContent = senderName;
            document.getElementById('replyBarText').textContent = text.substring(0, 100);
            document.getElementById('replyBar').classList.add('active');
            document.getElementById('msgInput').focus();
        }

        function cancelReply() {
            replyingTo = null;
            document.getElementById('replyBar').classList.remove('active');
        }

        // ============================================
        // SEARCH MODAL
        // ============================================
        document.getElementById('modalSearchInput').addEventListener('input', function(e) {
            const query = e.target.value.trim().replace('@', '');
            clearTimeout(searchTimeout);
            if (query.length < 2) {
                document.getElementById('modalStatus').classList.remove('visible');
                return;
            }
            searchTimeout = setTimeout(function() { searchUsers(query); }, 300);
        });

        async function searchUsers(query) {
            const statusEl = document.getElementById('modalStatus');
            const resultsEl = document.getElementById('modalResults');
            
            statusEl.className = 'modal-status visible';
            statusEl.textContent = 'Поиск...';
            statusEl.style.color = 'var(--accent-color)';
            
            try {
                const res = await fetch('/api/v1/users/search?q=' + encodeURIComponent(query), {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                
                if (data.users && data.users.length > 0) {
                    statusEl.className = 'modal-status visible found';
                    statusEl.textContent = '✅ Найдено: ' + data.users.length;
                    
                    resultsEl.innerHTML = data.users.map(function(u) {
                        const name = u.firstName || u.lastName || 'Пользователь';
                        const ph = (u.firstName || u.username)[0].toUpperCase();
                        return '<div class="user-item">' +
                            renderAvatar(u.avatarUrl, ph, 'user-avatar', u.username, name) +
                            '<div class="user-info">' +
                            '<div class="user-name">' + name + '</div>' +
                            '<div class="user-username">@' + u.username + '</div>' +
                            '</div>' +
                            '<button class="user-action-btn" onclick="startChatFromModal(\'' + u.id + '\', \'' + u.username + '\', \'' + name + '\', this)">Написать</button>' +
                            '</div>';
                    }).join('');
                } else {
                    statusEl.className = 'modal-status visible not-found';
                    statusEl.textContent = '❌ Ничего не найдено';
                    resultsEl.innerHTML = '<div class="modal-empty"><div class="modal-empty-icon">😕</div><div>Ничего не найдено</div></div>';
                }
            } catch (err) {
                statusEl.className = 'modal-status visible not-found';
                statusEl.textContent = '❌ Ошибка';
            }
        }

        async function startChatFromModal(userId, username, name, btn) {
            if (userId === user.id) {
                showToast('error', 'Нельзя создать чат с собой', '⚠️');
                return;
            }
            
            btn.disabled = true;
            btn.textContent = '...';
            
            try {
                const res = await fetch('/api/v1/chats/create', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ type: 'private', participants: [userId] })
                });
                const data = await res.json();
                
                if (data.chatId) {
                    btn.className = 'user-action-btn success';
                    btn.textContent = '✓';
                    
                    chatUsers[data.chatId] = { id: userId, username: username, name: name, av: name[0] };
                    
                    setTimeout(function() {
                        closeSearchModal();
                        loadChats().then(function() {
                            const chat = allChats.find(function(c) { return c.id === data.chatId; });
                            if (chat) openChat(chat.id, chat.name);
                        });
                    }, 500);
                }
            } catch (err) {
                btn.disabled = false;
                btn.textContent = 'Написать';
                showToast('error', 'Ошибка', '❌');
            }
        }

        // ============================================
        // CHATS
        // ============================================
        async function decryptLastMessage(c) {
            if (!c.lastMessageEncrypted || !c.lastMessageIv || !window.E2E) return c.lastMessage || '';
            try {
                return await window.E2E.decrypt(c.lastMessage, c.lastMessageIv, c.id, token);
            } catch (_) {
                return c.lastMessage || '';
            }
        }

        function formatCallLastMessage(c, text) {
            let callData = {};
            const raw = text || c.lastMessage || c.content || '';
            if (typeof raw === 'string') {
                try { callData = JSON.parse(raw || '{}'); } catch(_) {}
            } else if (raw && typeof raw === 'object') {
                callData = raw;
            }

            const senderId = c.lastMessageSenderId || c.sender_id || c.senderId || c.sender?.id;
            const isOutgoingCall = senderId && String(senderId) === String(user.id);
            const isVideo = callData.callKind !== 'audio';

            if (callData.status === 'missed') {
                return isOutgoingCall ? '📞 ' + tr('unansweredCall', 'Звонок без ответа') : '📞 ' + tr('incomingMissedCall', 'Пропущенный звонок');
            }

            return isVideo ? '📹 ' + tr('videoCall', 'Видеозвонок') : '📞 ' + tr('audioCall', 'Аудиозвонок');
        }

        function pollIconSvg(size) {
            const s = size || 14;
            return '<svg class="poll-preview-icon" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>';
        }

        function formatLastMessageType(c, text) {
                        if (c.lastMessageType === 'image' || c.lastMessageType === 'photo') return '🖼️ ' + tr('photoMessage', 'Фото');
            if (c.lastMessageType === 'video') return '🎬 ' + tr('videoMessage', 'Видео');
            if (c.lastMessageType === 'gif') return '🎞️ GIF';
            if (c.lastMessageType === 'sticker') return '🎨 ' + tr('stickerMessage', 'Стикер');
            if (c.lastMessageType === 'video_note') return '⭕ ' + tr('videoNoteMessage', 'Кружок');
            if (c.lastMessageType === 'call' || c.type === 'call') return formatCallLastMessage(c, text);
            if (c.lastMessageType === 'poll') return pollIconSvg(14) + tr('pollMessage', 'Опрос');
            return text || '';
        }

        function formatLastMessageFromMessage(msg, fallback) {
            if (!msg) return fallback || '';
            const content = isCraneAppBotMessage(msg) ? localizeBotMessageText(msg.content || '') : (msg.content || '');
            return formatLastMessageType({
                type: msg.type || 'text',
                lastMessageType: msg.type || 'text',
                lastMessage: content,
                lastMessageSenderId: msg.sender_id || msg.senderId || msg.sender?.id
            }, content) || fallback || '';
        }

        function isCraneAppBotLastMessage(c) {
            const senderId = c.lastMessageSenderId || c.sender_id || c.senderId || c.sender?.id;
            const chatUser = chatUsers[c.id];
            return !!(chatUser && chatUser.isBot && senderId && String(senderId) === String(chatUser.id));
        }

        // Возвращает объект с lastMessage и опционально _rawEncrypted/_rawIv для отложенной расшифровки
        function formatLastMessage(c) {
            const typeOverride = formatLastMessageType(c, null);
            if (typeOverride) return typeOverride; // медиа — не шифруется в тексте
            if (c.lastMessageEncrypted && c.lastMessageIv) {
                // Вернём пустую строку пока, расшифруем позже
                return '';
            }
            return isCraneAppBotLastMessage(c) ? localizeBotMessageText(c.lastMessage || '') : (c.lastMessage || '');
        }

        // Подготавливает объект чата — сохраняет raw данные для расшифровки
        function prepareChatEntry(c, base) {
            const entry = Object.assign({}, base);
            entry.mentionCount = Number(entry.mentionCount ?? c.mentionCount) || 0;
            entry.latestMentionAt = entry.latestMentionAt || c.latestMentionAt || null;
            entry.oldestMentionMessageId = entry.oldestMentionMessageId || c.oldestMentionMessageId || null;
            entry.mentionReadAt = entry.mentionReadAt || c.mentionReadAt || null;
            entry.lastMessagePlain = base.lastMessagePlain || c.lastMessagePlain || null;
            if (c.lastMessageEncrypted && c.lastMessageIv) {
                entry._rawEncrypted = c.lastMessage;
                entry._rawIv = c.lastMessageIv;
                entry.lastMessage = '';
            }
            return entry;
        }

        async function loadChats() {
            try {
                // Сначала загружаем архивированные чаты (чтобы они были доступны при рендеринге)
                await loadArchivedChats();
                
                // Затем загружаем обычные чаты
                const chatsRes = await fetch('/api/v1/chats', { 
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await chatsRes.json();
                
                // Сбрасываем pinned чаты и заполняем из данных
                pinnedChatIds = new Set();
                
                // Очищаем массивы
                allChats = [];
                
                // Map для защиты от дубликатов - используем для всех чатов
                const uniqueChats = new Map(); // chatId -> chatData
                
                if (data.chats && data.chats.length > 0) {
                    // Сначала загружаем все приватные чаты и их участников
                    const privateChats = [];
                    const otherChats = [];
                    
                    // Разделяем чаты на приватные и другие
                    for (let i = 0; i < data.chats.length; i++) {
                        const c = data.chats[i];
                        if (c.type === 'private') {
                            privateChats.push(c);
                        } else {
                            otherChats.push(c);
                        }
                    }
                    
                    // Обрабатываем приватные чаты — параллельно с таймаутом 5с
                    function fetchWithTimeout(url, opts, ms) {
                        const ctrl = new AbortController();
                        const tid = setTimeout(() => ctrl.abort(), ms);
                        return fetch(url, { ...opts, signal: ctrl.signal })
                            .finally(() => clearTimeout(tid));
                    }

                    const memberResults = await Promise.allSettled(
                        privateChats.map(c => {
                            if (uniqueChats.has(c.id)) return Promise.resolve({ skip: true, c });
                            return fetchWithTimeout('/api/v1/chats/' + c.id + '/members',
                                { headers: { 'Authorization': 'Bearer ' + token } }, 5000)
                                .then(r => r.ok ? r.json().then(d => ({ c, mData: d })) : Promise.resolve({ c, status: r.status }))
                                .catch(() => ({ c, timeout: true }));
                        })
                    );

                    for (const result of memberResults) {
                        if (result.status === 'rejected') continue;
                        const val = result.value;
                        if (!val || val.skip) continue;
                        const c = val.c;

                        // При таймауте или ошибке — используем кэш
                        if (val.timeout || val.status) {
                            const cached = chatUsers[c.id];
                            if (cached) {
                                uniqueChats.set(c.id, prepareChatEntry(c, {
                                    id: c.id, name: cached.name, av: cached.av,
                                    lastMessage: formatLastMessage(c),
                                    time: c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '',
                                    isOnline: cached.isOnline, isPinned: c.isPinned || false,
                                    lastMessageType: c.lastMessageType,
                                    unreadCount: c.unreadCount || 0
                                }));
                                if (c.isPinned) pinnedChatIds.add(c.id);
                            }
                            continue;
                        }

                        const other = val.mData && val.mData.members && val.mData.members.find(function(m) {
                            return m.id !== user.id;
                        });

                        if (other) {
                            // Удаляем дубликаты по пользователю
                            for (const [existingChatId] of uniqueChats) {
                                const existingUser = chatUsers[existingChatId];
                                if (existingUser && existingUser.id === other.id) {
                                    uniqueChats.delete(existingChatId);
                                    break;
                                }
                            }

                            chatUsers[c.id] = {
                                id: other.id,
                                username: other.username,
                                name: other.first_name || other.username,
                                av: other.avatar_url || (other.first_name ? other.first_name[0] : other.username[0]),
                                bio: other.bio || '',
                                isOnline: other.is_blocked ? false : other.is_online,
                                lastSeen: other.last_seen,
                                badge: other.badge || null,
                                badges: other.badges || [],
                                isBot: other.is_bot || false,
                                isPremium: other.is_premium || false,
                                isBlocked: other.is_blocked || false
                            };

                            uniqueChats.set(c.id, prepareChatEntry(c, {
                                id: c.id,
                                name: chatUsers[c.id].name,
                                av: chatUsers[c.id].av,
                                lastMessage: formatLastMessage(c),
                                lastMessageAt: c.lastMessageAt || null,
                                time: c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '',
                                isOnline: other.is_online,
                                isPinned: c.isPinned || false,
                                lastMessageType: c.lastMessageType,
                                badge: other.badge || null,
                                isBot: other.is_bot || false,
                                unreadCount: c.unreadCount || 0,
                                role: c.role,
                                ownerId: c.ownerId
                            }));

                            if (c.isPinned) pinnedChatIds.add(c.id);
                        }
                    }
                    
                    // Обрабатываем групповые чаты и каналы
                    for (let i = 0; i < otherChats.length; i++) {
                        const c = otherChats[i];
                        
                        // Пропускаем если уже обработали этот чат
                        if (uniqueChats.has(c.id)) {
                            continue;
                        }
                        
                        let lastMsgText = formatLastMessage(c);
                        
                         // Добавляем в Map
                         uniqueChats.set(c.id, prepareChatEntry(c, {
                             id: c.id,
                             name: c.title || 'Чат',
                             av: c.avatarUrl || (c.title ? c.title[0] : '?'),
                             avatarUrl: c.avatarUrl || null,
                             type: c.type,
                             isSupergroup: c.isSupergroup || false,
                             lastMessage: lastMsgText,
                             lastMessageAt: c.lastMessageAt || null,
                             lastMessageSenderId: c.lastMessageSenderId,
                             time: c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '',
                             isPinned: c.isPinned || false,
                             unreadCount: c.unreadCount || 0,
                              role: c.role,
                              ownerId: c.ownerId
                         }));
                        
                        // Добавляем в pinnedChatIds если чат закреплён
                        if (c.isPinned) {
                            pinnedChatIds.add(c.id);
                        }
                    }
                }
                
                // Конвертируем Map в массив
                allChats = Array.from(uniqueChats.values());

                // Расшифровываем lastMessage для зашифрованных чатов
                if (window.E2E) {
                    if (window.e2eInitPromise) {
                        try { await window.e2eInitPromise; } catch (_) {}
                    }
                    await Promise.all(allChats.map(async c => {
                        if (c._rawEncrypted && c._rawIv) {
                            try {
                                const plain = await window.E2E.decrypt(c._rawEncrypted, c._rawIv, c.id, token);
                                let localizedPlain;
                                if (plain === '🔒 [зашифровано]' && c.lastMessagePlain) {
                                    localizedPlain = isCraneAppBotLastMessage(c) ? localizeBotMessageText(c.lastMessagePlain) : c.lastMessagePlain;
                                } else {
                                    localizedPlain = isCraneAppBotLastMessage(c) ? localizeBotMessageText(plain) : plain;
                                }
                                c.lastMessage = formatLastMessageType(c, localizedPlain);
                            } catch (_) {}
                            delete c._rawEncrypted;
                            delete c._rawIv;
                        }
                    }));
                }

                // Рендерим после загрузки ВСЕХ данных включая архивированные
                renderChatList();
                initFolderTabs();
            } catch (err) {
                console.error('Load chats error:', err);
                allChats = [];
                archivedChats = [];
                renderChatList();
            }
        }

        let activeFolder = null; // null = все чаты

        // Значки — принимает массив badges + флаги isBot, isPremium, isFake, isScam
        function makeBadgeSvg(g1, g2, id) {
            return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-left:3px;flex-shrink:0">'
                + '<circle cx="8" cy="8" r="8" fill="url(#' + id + ')"/>'
                + '<path d="M4.5 8L7 10.5L11.5 5.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
                + '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">'
                + '<stop stop-color="' + g1 + '"/><stop offset="1" stop-color="' + g2 + '"/>'
                + '</linearGradient></defs></svg>';
        }

        const BADGE_DEFS = {
            developer: () => makeBadgeSvg('#FF007F', '#9D00FF', 'bd' + Math.random().toString(36).slice(2,6)),
            verified:  () => makeBadgeSvg('#FF007F', '#9D00FF', 'bv' + Math.random().toString(36).slice(2,6)),
            admin:     () => makeBadgeSvg('#0088FF', '#00C8C8', 'ba' + Math.random().toString(36).slice(2,6)),
            premium:   () => '<span style="display:inline-block;vertical-align:middle;margin-left:3px;font-size:13px;line-height:1;filter:drop-shadow(0 0 3px #FFD700)">⭐</span>',
            bot:       () => makeBadgeSvg('#FF007F', '#9D00FF', 'bb' + Math.random().toString(36).slice(2,6)),
            fake:      () => '<span style="color:#FF4B4B;font-size:10px;font-weight:700;margin-left:3px;vertical-align:middle">FAKE</span>',
            scam:      () => '<span style="color:#FF4B4B;font-size:10px;font-weight:700;margin-left:3px;vertical-align:middle">SCAM</span>',
        };

        function renderBadges(badges, isBot, isPremium, isFake, isScam) {
            let html = '';
            // Если это бот — показываем только одну галочку бота
            if (isBot) {
                return BADGE_DEFS['bot']();
            }
            const list = Array.isArray(badges) ? [...badges] : (badges ? [badges] : []);
            if (isPremium && !list.includes('premium')) list.push('premium');
            if (isFake) list.push('fake');
            if (isScam) list.push('scam');
            for (const b of list) {
                if (BADGE_DEFS[b]) html += BADGE_DEFS[b]();
            }
            return html;
        }

        // Обратная совместимость
        function renderBadge(badge, isBot) {
            return renderBadges(badge ? [badge] : [], isBot, false, false, false);
        }
        function initFolderTabs() {
            const folders = JSON.parse(localStorage.getItem('craneapp_folders') || '[]');
            const tabsEl = document.getElementById('folderTabs');
            if (!folders.length) { tabsEl.style.display = 'none'; return; }

            tabsEl.style.display = 'flex';
            let html = '<div class="ftab' + (!activeFolder ? ' active' : '') + '" onclick="setFolder(null)">💬 Все</div>';
            folders.forEach(f => {
                const isActive = activeFolder === f.id;
                html += '<div class="ftab' + (isActive ? ' active' : '') + '" onclick="setFolder(\'' + f.id + '\')">' + f.icon + ' ' + f.name + '</div>';
            });
            tabsEl.innerHTML = html;
        }

        function setFolder(folderId) {
            activeFolder = folderId;
            initFolderTabs();
            renderChatList();
        }

        function renderUnreadBadge(chat) {
            const count = Number(chat && chat.unreadCount) || 0;
            if (count <= 0) return '';
            return '<div class="unread-badge">' + (count > 99 ? '99+' : count) + '</div>';
        }

        function renderChatUnreadIndicators(chat) {
            const showMention = mentionHelpers.chatHasUnreadMention(chat);
            const unreadHtml = renderUnreadBadge(chat);
            if (!showMention && !unreadHtml) return '';
            return '<div class="chat-unread-indicators">'
                + (showMention ? '<div class="mention-badge" aria-label="' + tr('jumpToMention', 'К непрочитанному упоминанию') + '"><span class="mention-badge-at">@</span></div>' : '')
                + unreadHtml
                + '</div>';
        }

        function renderChatMeta(chat) {
            const indicators = renderChatUnreadIndicators(chat);
            return '<div class="chat-meta">'
                + '<div class="chat-time">' + (chat.time || '') + '</div>'
                + (indicators || '')
                + '</div>';
        }

        async function markChatAsRead(chatId, options = {}) {
            if (!chatId) return false;

            const res = await fetch('/api/v1/chats/' + chatId + '/read', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });
            if (!res.ok) throw new Error('mark read failed');
            const data = await res.json().catch(function() { return {}; });

            [allChats, archivedChats].forEach(function(list) {
                const chat = list.find(c => c.id === chatId);
                if (chat) {
                    chat.unreadCount = 0;
                    Object.assign(chat, mentionHelpers.clearMentionState(chat));
                    if (data.mentionReadAt) chat.mentionReadAt = data.mentionReadAt;
                }
            });
            if (activeChat && activeChat.id === chatId && data.mentionReadAt) {
                activeChat.mentionReadAt = data.mentionReadAt;
            }
            if (options.acknowledgeMentions) {
                acknowledgeChatMentionsOnOpen(chatId);
            }
            renderChatList();
            if (activeChat && activeChat.id === chatId) {
                updateMentionJumpButton();
            }

            if (!options.silent) {
                showToast('success', tr('chatMarkedAsRead', 'Чат помечен прочитанным'), '✓');
            }
            return true;
        }

        function renderChatList(filter) {
            filter = filter || '';
            
            const list = document.getElementById('chatList');
            
            // Сортируем по времени последнего сообщения (новые выше)
            allChats.sort((a, b) => {
                const ta = a.lastMessageAt ? new Date(a.lastMessageAt) : (a.time ? new Date('1970/01/01 ' + a.time) : new Date(0));
                const tb = b.lastMessageAt ? new Date(b.lastMessageAt) : (b.time ? new Date('1970/01/01 ' + b.time) : new Date(0));
                return tb - ta;
            });

            // Разделяем на закреплённые и обычные
            let pinnedChats = [];
            let normalChats = [];

            // Фильтр по активной папке
            let chatsToShow = allChats;
            if (activeFolder) {
                const folders = JSON.parse(localStorage.getItem('craneapp_folders') || '[]');
                const folder = folders.find(f => f.id === activeFolder);
                if (folder) {
                    const ids = new Set(folder.chatIds || folder.chats || []);
                    chatsToShow = allChats.filter(c => ids.has(c.id));
                }
            }
            
            chatsToShow.forEach(function(c) {
                if (pinnedChatIds.has(c.id)) {
                    c.isPinned = true;
                    pinnedChats.push(c);
                } else {
                    normalChats.push(c);
                }
            });
            
            const filtered = filter ? normalChats.filter(function(c) { 
                return c.name.toLowerCase().indexOf(filter.toLowerCase()) >= 0; 
            }) : normalChats;
            
            let html = '';
            
            // Секция архивированных — ПЕРВОЙ (как в Telegram)
            if (archivedChats.length > 0 && !filter) {
                html += '<div class="archived-chats-section">';
                html += '<div class="archived-chats-header" onclick="toggleArchivedChats()">📁 ' + tr('archived', 'Archived') + ' (' + archivedChats.length + ')</div>';
                html += '<div class="archived-chats-list" id="archivedChatsList" style="display: block;">';
                html += archivedChats.map(function(c) {
                    const name = c.name || c.title || tr('chatShort', 'Чат');
                    const ph = c.av || c.avatarUrl || (name[0] || '?');
                    const safeName = escapeHtml(name);
                    const safeLastMsg = escapeHtml(c.lastMessage || tr('noMessages', 'Нет сообщений'));
                    return '<div class="chat-item" onclick="openArchivedChat(\'' + c.id + '\', \'' + name + '\')">' +
                        renderAvatar(ph, name[0], 'avatar', '', name) +
                        '<div class="chat-info"><div class="chat-name">' + safeName + '</div>' +
                        '<div class="chat-last">' + safeLastMsg + '</div></div>' +
                        renderChatMeta(c) +
                        '<div class="chat-actions"><button class="chat-action-icon" onclick="event.stopPropagation(); unarchiveChat(\'' + c.id + '\')" title="' + tr('restore', 'Восстановить') + '">📥</button></div>' +
                        '</div>';
                }).join('');
                html += '</div></div>';
            }

            // Секция закреплённых
            if (pinnedChats.length > 0 && !filter) {
                html += '<div class="pinned-chats-section" style="margin-bottom: 8px;">';
                html += '<div class="pinned-chats-header" style="color: var(--accent-color); font-weight: 600;">📌 ' + tr('pinned', 'Pinned') + '</div>';
                
                html += pinnedChats.map(function(c) {
                    const isActive = activeChat && activeChat.id === c.id;
                    const ph = typeof c.av === 'string' && c.av.length <= 2 ? c.av : c.name[0];
                    const safeName = escapeHtml(c.name);
                    const safeLastMsg = escapeHtml(c.lastMessage || tr('noMessages', 'Нет сообщений'));
                    return '<div class="chat-item pinned ' + (isActive ? 'active' : '') + '" ' +
                        'data-chat-type="' + (c.type || (c.isGroup ? 'group' : 'private')) + '" ' +
                        'onclick="openChat(\'' + c.id + '\', \'' + c.name + '\')" ' +
                        'oncontextmenu="showChatContextMenu(event, \'' + c.id + '\')" ' +
                        'style="background: linear-gradient(90deg, rgba(255,0,127,0.15) 0%, transparent 100%); border-left: 3px solid var(--accent-color);">' +
                        renderAvatar(c.av, ph, 'avatar', c.isBot ? 'craneapp_bot' : '', c.name) +
                        '<div class="chat-info">' +
                        '<div class="chat-name" style="color: var(--accent-color);"><span class="pin-icon">📌</span> ' + safeName + '</div>' +
                        '<div class="chat-last">' + safeLastMsg + '</div>' +
                        '</div>' +
                        renderChatMeta(c) +
                        '<div class="chat-actions">' +
                        '<button class="chat-action-icon pinned" onclick="event.stopPropagation(); unpinChat(\'' + c.id + '\')" title="' + tr('unpin', 'Открепить') + '" style="color: var(--accent-color);">📌</button>' +
                        '<button class="chat-action-icon archived" onclick="event.stopPropagation(); archiveChat(\'' + c.id + '\')" title="' + tr('archiveChat', 'Архивировать') + '">📁</button>' +
                        '</div>' +
                        '</div>';
                }).join('');
                
                html += '</div>';
            }
            
            // Секция обычных чатов
            if (filtered.length === 0 && !pinnedChats.length) {
                html += '<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:14px;">' + tr('noChats', 'Нет чатов') + '</div>';
            } else {
                html += filtered.map(function(c) {
                    const isActive = activeChat && activeChat.id === c.id;
                    const ph = typeof c.av === 'string' && c.av.length <= 2 ? c.av : c.name[0];
                    const chatUser = chatUsers[c.id];
                    const isBlocked = chatUser && chatUser.isBlocked;
                    // Журавль для бота CraneApp или призрак для заблокированных
                    let avatarHtml;
                    if (isBlocked) {
                        avatarHtml = '<div class="avatar blocked">\uD83D\uDEAB</div>';
                    } else if (c.isBot || (c.badge === 'verified' && c.name === 'CraneApp')) {
                        avatarHtml = '<div class="avatar"><img class="avatar-img" src="/logo.png" alt=""/></div>';
                    } else {
                        const _initial = (c.name ? c.name.charAt(0).toUpperCase() : '?');
                        avatarHtml = renderAvatar(c.av, _initial, 'avatar', c.isBot ? 'craneapp_bot' : '', c.name);
                    }
                    const displayName = isBlocked ? tr('blockedAccount', 'Заблокированный аккаунт') : c.name;
                    const safeName = escapeHtml(displayName);
                    const safeLastMsg = escapeHtml(c.lastMessage || tr('noMessages', 'Нет сообщений'));
                    return '<div class="chat-item ' + (isActive ? 'active' : '') + '" ' +
                        'data-chat-type="' + (c.type || (c.isGroup ? 'group' : 'private')) + '" ' +
                        'onclick="openChat(\'' + c.id + '\', \'' + displayName + '\')" ' +
                        'oncontextmenu="showChatContextMenu(event, \'' + c.id + '\')">' +
                        avatarHtml +
                        '<div class="chat-info">' +
                        '<div class="chat-name">' + safeName + (c.badge || c.isBot ? renderBadge(c.badge, c.isBot) : '') + '</div>' +
                        '<div class="chat-last">' + safeLastMsg + '</div>' +
                        '</div>' +
                        renderChatMeta(c) +
                        '<div class="chat-actions">' +
                        '<button class="chat-action-icon" onclick="event.stopPropagation(); pinChat(\'' + c.id + '\')" title="' + tr('pin', 'Закрепить') + '">📌</button>' +
                        '<button class="chat-action-icon archived" onclick="event.stopPropagation(); archiveChat(\'' + c.id + '\')" title="' + tr('archiveChat', 'Архивировать') + '">📁</button>' +
                        '</div>' +
                        '</div>';
                }).join('');
            }
            
            list.innerHTML = html;
        }

        document.getElementById('searchInput').addEventListener('input', function(e) {
            // handled by handleUnifiedSearch via oninput
        });

        let unifiedSearchTimeout;
        function handleUnifiedSearch(q) {
            clearTimeout(unifiedSearchTimeout);
            if (!q) { renderChatList(); return; }
            unifiedSearchTimeout = setTimeout(async () => {
                // Фильтруем локальные чаты
                renderChatList(q);
                // Ищем пользователей если запрос похож на юзернейм или имя
                if (q.length >= 2) {
                    try {
                        const res = await fetch('/api/v1/users/search?q=' + encodeURIComponent(q.replace('@','')), {
                            headers: { 'Authorization': 'Bearer ' + token }
                        });
                        if (!res.ok) return;
                        const data = await res.json();
                        const users = (data.users || []).filter(u => u.id !== user.id);
                        if (users.length) {
                        // Добавляем найденных пользователей в список чатов как отдельную секцию
                        const list = document.getElementById('chatList');
                        let section = document.getElementById('userSearchResults');
                        if (!section) {
                            section = document.createElement('div');
                            section.id = 'userSearchResults';
                            list.appendChild(section);
                        }
                        section.innerHTML = '<div style="padding:8px 16px 4px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);">' + escapeHtml(tr('people', 'Люди')) + '</div>' +
                            users.map(u => {
                                const safeUsername = escapeHtml(u.username || '');
                                const safeFirstName = escapeHtml(u.firstName || '');
                                const safeInitial = escapeHtml((u.firstName||u.username||'U')[0]);
                                // Журавль для бота CraneApp
                                const av = u.username === 'craneapp_bot'
                                    ? '<img src="/logo.png" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                                    : (u.avatar_url && isImage(u.avatar_url)
                                        ? '<img src="' + u.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                                        : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#FF007F,#9D00FF);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-weight:700;">' + safeInitial + '</div>');
                                const displayName = u.firstName && u.lastName ? safeFirstName + ' ' + escapeHtml(u.lastName||'') : (safeFirstName || safeUsername || escapeHtml(tr('user', 'Пользователь')));
                                return '<div class="chat-item" onclick="startChatFromSearch(\''+escapeAttr(u.id)+'\',\''+escapeAttr(displayName)+'\')" style="padding:12px 16px;cursor:pointer;transition:background 0.2s;display:flex;align-items:center;gap:12px;">' +
                                    '<div style="width:48px;height:48px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--bg-tertiary);">'+av+'</div>' +
                                    '<div style="flex:1;min-width:0;">' +
                                        '<div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:2px;">'+displayName+'</div>' +
                                        '<div style="font-size:13px;color:var(--text-muted);">@'+safeUsername+'</div>' +
                                    '</div>' +
                                '</div>';
                            }).join('');
                        }
                    } catch (err) {
                        console.error('User search error:', err);
                    }
                }
                // Ищем публичные каналы
                try {
                    const chRes = await fetch('/api/v1/channels/search?q=' + encodeURIComponent(q.replace('@', '')), {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    if (chRes.ok) {
                        const chData = await chRes.json();
                        const channels = chData.channels || [];
                        if (channels.length) {
                            const list = document.getElementById('chatList');
                            let section = document.getElementById('channelSearchResults');
                            if (!section) {
                                section = document.createElement('div');
                                section.id = 'channelSearchResults';
                                list.appendChild(section);
                            }
                            section.innerHTML = '<div style="padding:8px 16px 4px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);">' + tr('channels', 'Каналы') + '</div>'
                                + channels.map(function(ch) {
                                    const subs = ch.subscriberCount || 0;
                                    const av = ch.avatarUrl && ch.avatarUrl.indexOf('http') === 0
                                        ? '<img src="' + ch.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                                        : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#00A0FF,#0066FF);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">' + (ch.title ? ch.title[0] : '📢') + '</div>';
                                    const btnLabel = ch.isSubscribed ? tr('open', 'Открыть') : tr('subscribe', 'Подписаться');
                                    const btnAction = ch.isSubscribed
                                        ? 'openChat(\'' + ch.id + '\', \'' + (ch.title || '').replace(/'/g, "\\'") + '\')'
                                        : 'subscribeToChannelFromSearch(\'' + ch.id + '\', \'' + (ch.title || '').replace(/'/g, "\\'") + '\')';
                                    return '<div class="chat-item" style="padding:12px 16px;display:flex;align-items:center;gap:12px;">'
                                        + '<div style="width:48px;height:48px;border-radius:50%;overflow:hidden;flex-shrink:0;">' + av + '</div>'
                                        + '<div style="flex:1;min-width:0;"><div style="font-weight:600;">' + escapeHtml(ch.title) + '</div>'
                                        + '<div style="font-size:12px;color:var(--text-muted);">' + (ch.username ? '@' + ch.username + ' · ' : '') + subs + ' ' + tr('subscribers', 'подписчиков') + '</div></div>'
                                        + '<button type="button" onclick="' + btnAction + '" style="padding:8px 12px;border-radius:10px;border:none;background:var(--accent-gradient);color:#fff;font-size:12px;font-weight:600;cursor:pointer;">' + btnLabel + '</button>'
                                        + '</div>';
                                }).join('');
                        }
                    }
                } catch (err) {
                    console.error('Channel search error:', err);
                }

                // Ищем по сообщениям
                try {
                    const res = await fetch('/api/v1/messages/search?q=' + encodeURIComponent(q), {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    if (!res.ok) {
                        console.error('Message search failed with status:', res.status);
                        return;
                    }
                    const data = await res.json();
                    const messages = data.messages || [];
                    if (!messages.length) return;

                    const list = document.getElementById('chatList');
                    let section = document.getElementById('messageSearchResults');
                    if (!section) {
                        section = document.createElement('div');
                        section.id = 'messageSearchResults';
                        list.appendChild(section);
                    }

                    section.innerHTML = '<div style="padding:8px 16px 4px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);">' + escapeHtml(tr('messagesLabel', 'Сообщения')) + '</div>' +
                        messages.map(m => {
                            const chatName = m.chatType === 'private'
                                ? escapeHtml(m.senderFirstName && m.senderLastName ? m.senderFirstName + ' ' + m.senderLastName : (m.senderFirstName || m.senderUsername || tr('user', 'Пользователь')))
                                : escapeHtml(m.chatName || tr('chatShort', 'Чат'));
                            const preview = escapeHtml(m.content.length > 50 ? m.content.substring(0, 50) + '...' : m.content);
                            const time = escapeHtml(new Date(m.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
                            return '<div class="chat-item" onclick="openChatFromMessageSearch(\''+escapeAttr(m.chatId)+'\',\''+escapeAttr(m.id)+'\')" style="padding:12px 16px;cursor:pointer;transition:background 0.2s;">' +
                                '<div style="flex:1;min-width:0;overflow:hidden;">' +
                                    '<div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+chatName+'</div>' +
                                    '<div style="font-size:13px;color:var(--text-primary);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+preview+'</div>' +
                                    '<div style="font-size:11px;color:var(--text-muted);">'+time+'</div>' +
                                '</div>' +
                            '</div>';
                        }).join('');
                } catch (err) {
                    console.error('Message search error:', err);
                }
            }, 300);
        }

        function escapeAttr(s) { return String(s||'').replace(/[&<>"'\/]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;'}[c];}); }
        function escapeHtml(s) { return String(s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }

        async function startChatFromSearch(userId, name, username) {
            document.getElementById('searchInput').value = '';
            handleUnifiedSearch('');
            try {
                const res = await fetch('/api/v1/chats/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ type: 'private', participants: [userId] })
                });
                const data = await res.json();
                if (data.chatId) {
                    await loadChats();
                    openChat(data.chatId, name);
                }
            } catch (_) { showToast('error', 'Ошибка', '❌'); }
        }

        async function openChatFromMessageSearch(chatId, messageId) {
            document.getElementById('searchInput').value = '';
            handleUnifiedSearch('');
            const chat = allChats.find(c => c.id === chatId);
            const chatName = chat ? chat.name : 'Чат';
            openChat(chatId, chatName);
            // После загрузки сообщений прокрутим к нужному
            setTimeout(() => {
                const msgEl = document.querySelector('[data-message-id="' + messageId + '"]');
                if (msgEl) {
                    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    msgEl.style.background = 'rgba(255, 0, 127, 0.2)';
                    setTimeout(() => msgEl.style.background = '', 2000);
                }
            }, 500);
        }

        // ============================================
        // OPEN/CLOSE CHAT
        // ============================================
        async function openChat(id, name, topicId) {
            if (typeof window.restoreChannelFeedUi === 'function') {
                window.restoreChannelFeedUi();
            }
            hideMentionSuggestions();
            // Сохраняем черновик предыдущего чата
            const advSettings = JSON.parse(localStorage.getItem('craneapp_advanced_settings') || '{}');
            const saveDrafts = advSettings.saveDrafts !== false;
            if (saveDrafts && activeChat) {
                const draft = document.getElementById('msgInput').innerText;
                if (draft) localStorage.setItem('crane_draft_' + activeChat.id, draft);
                else localStorage.removeItem('crane_draft_' + activeChat.id);
            }

            const chatInfo = allChats.find(c => c.id === id);
            activeChat = { 
                id: id, 
                name: name, 
                type: chatInfo?.type || 'private',
                isSupergroup: chatInfo?.isSupergroup || false,
                ownerId: chatInfo?.ownerId,
                role: chatInfo?.role,
                mentionReadAt: chatInfo?.mentionReadAt || null,
                mentionCount: chatInfo?.mentionCount || 0,
                mutedUntil: chatInfo?.mutedUntil || null
            };

            if (activeChat.type === 'group') {
                mentionJumpCursorByChat[id] = chatInfo?.mentionReadAt || '';
                loadGroupMembersForMentions(id);
            } else {
                groupMembersForMentions = [];
                currentUserGroupOnline = false;
            }

            activeChat.channelMeta = null;
            if (activeChat.type !== 'channel' && typeof window.cleanupChannelComposer === 'function') {
                window.cleanupChannelComposer();
            }
            if (activeChat.type === 'channel' && typeof window.loadChannelMeta === 'function') {
                window.loadChannelMeta(activeChat);
            }

            // Показываем кнопку участников только для групп
            const membersBtn = document.getElementById('membersBtn');
            if (membersBtn) membersBtn.style.display = activeChat.type === 'group' ? 'flex' : 'none';

            const audioCallBtn = document.getElementById('audioCallBtn');
            const videoCallBtn = document.getElementById('videoCallBtn');
            const isBotChat = activeChat.type === 'private' && activeChat.otherUser && (activeChat.otherUser.is_bot || activeChat.otherUser.username === 'craneapp_bot');
            const hideCallBtns = activeChat.type === 'channel' || isBotChat;
            if (audioCallBtn) audioCallBtn.style.display = hideCallBtns ? 'none' : '';
            if (videoCallBtn) videoCallBtn.style.display = hideCallBtns ? 'none' : '';
            updatePollButtonVisibility();
            setScrollBottomButtonEnabled(true);
            setMentionJumpButtonEnabled(activeChat.type === 'group');

            messagesData = {};
            renderChatList();

            // Проверяем статус мута
            checkMuteStatus();
            
            if (window.innerWidth < 768) {
                document.getElementById('sidebar').classList.add('hidden');
                document.body.classList.add('chat-open');
            }

            document.getElementById('noChat').style.display = 'none';
            document.getElementById('chatView').classList.add('active');

            // Имя + бейджи в хедере
            const chatUserForBadge = chatUsers[id];
            const isBlocked = chatUserForBadge && chatUserForBadge.isBlocked;
            const displayName = isBlocked ? 'Заблокированный аккаунт' : (chatUserForBadge?.name || name);
            const chatBadgesHtml = chatUserForBadge && !isBlocked
                ? renderBadges(chatUserForBadge.badges || [], chatUserForBadge.isBot, chatUserForBadge.isPremium, false, false)
                : '';
            const chatNameEl = document.getElementById('chatName');
            if (chatBadgesHtml) {
                chatNameEl.innerHTML = escapeHtml(displayName) + chatBadgesHtml;
            } else {
                chatNameEl.textContent = displayName;
            }

            // Кнопка support requests — только разработчикам в чате с ботом
            const supportBtn = document.getElementById('supportRequestsBtn');
            const reportsBtn = document.getElementById('reportsBtn');
            const isDevUser = ['adm1','admin','admin1','qzlfee'].includes((user.username||'').toLowerCase());
            if (isBotChat && isDevUser) {
                supportBtn.style.display = 'flex';
                reportsBtn.style.display = 'flex';
            } else {
                supportBtn.style.display = 'none';
                reportsBtn.style.display = 'none';
            }
            // Скрываем панель support и reports при смене чата
            document.getElementById('supportPanel').style.display = 'none';
            document.getElementById('reportsPanel').style.display = 'none';
            document.getElementById('messages').style.display = 'flex';

            // Показываем баннер если есть активный support request
            const activeSupportRaw = localStorage.getItem('craneapp_active_support_request');
            const existingBanner = document.getElementById('supportReplyBanner');
            if (existingBanner) existingBanner.remove();
            if (isBotChat && isDevUser && activeSupportRaw) {
                try {
                    const activeSupport = JSON.parse(activeSupportRaw);
                    const banner = document.createElement('div');
                    banner.id = 'supportReplyBanner';
                    banner.style.cssText = 'background:linear-gradient(135deg,rgba(255,0,127,.15),rgba(157,0,255,.15));border-bottom:1px solid rgba(255,0,127,.3);padding:8px 16px;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:8px';
                    banner.innerHTML = '<span>📨 Режим ответа на запрос поддержки. Ваш ответ будет анонимно переслан пользователю.</span>'
                        + '<button onclick="localStorage.removeItem(\'craneapp_active_support_request\');this.parentNode.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;flex-shrink:0">✕</button>';
                    const msgContainer = document.getElementById('messagesContainer');
                    msgContainer.parentNode.insertBefore(banner, msgContainer);
                } catch (_) {}
            }
            
            const chatUser = chatUsers[id];
            const avatarEl = document.getElementById('chatAvatar');
            const statusEl = document.getElementById('chatStatus');

            // Для групп — берём аватарку из allChats
            const groupAvatarUrl = chatInfo?.avatarUrl || chatInfo?.av;

            if (activeChat && activeChat.type === 'group') {
                if (groupAvatarUrl && isImage(groupAvatarUrl)) {
                    avatarEl.innerHTML = '<img class="avatar-img" src="' + groupAvatarUrl + '" alt="">';
                    avatarEl.style.background = 'transparent';
                } else {
                    avatarEl.innerHTML = '<span>' + (name[0] || '💬') + '</span>';
                    avatarEl.style.background = getAvatarGradient(name);
                }
            } else if (chatUser && chatUser.isBlocked) {
                // Призрак для заблокированных
                avatarEl.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18v-6a3 3 0 0 1 6 0v6"/><path d="M6 18a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-6a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v6z"/><path d="M12 2a5 5 0 0 0-5 5v2h10V7a5 5 0 0 0-5-5z"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="16" r="1"/></svg>';
                avatarEl.style.background = '#333';
            } else if (chatUser && chatUser.username === 'craneapp_bot') {
                // Журавль для бота CraneApp
                avatarEl.innerHTML = '<img class="avatar-img" src="/logo.png" alt="">';
                avatarEl.style.background = 'transparent';
            } else if (chatUser && isImage(chatUser.av)) {
                avatarEl.innerHTML = '<img class="avatar-img" src="' + chatUser.av + '" alt="">';
                avatarEl.style.background = 'transparent';
            } else {
                const ph = chatUser?.av || (name[0] || '?');
                avatarEl.innerHTML = '<span>' + ph + '</span>';
                avatarEl.style.background = getAvatarGradient(name);
            }
            
            // Обновляем статус онлайн
            if (chatUser) {
                if (chatUser.isBlocked) {
                    statusEl.textContent = tr('accountBlocked', 'Account blocked');
                    statusEl.style.color = '#FF4B4B';
                } else {
                    updateChatUserStatus(chatUser.id);
                }
            } else if (activeChat && activeChat.type === 'channel') {
                statusEl.style.color = 'var(--text-muted)';
                statusEl.textContent = tr('loading', 'Загрузка...');
                fetch('/api/v1/channels/' + id, { headers: { 'Authorization': 'Bearer ' + token } })
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (!data || !data.channel) return;
                        activeChat.channelMeta = data.channel;
                        activeChat.role = data.channel.role || activeChat.role;
                        const subs = data.channel.subscriberCount || 0;
                        const uname = data.channel.username ? '@' + data.channel.username : '';
                        statusEl.textContent = (uname ? uname + ' · ' : '') + subs + ' ' + tr('subscribers', 'подписчиков');
                        if (typeof window.applyChannelComposerState === 'function') {
                            window.applyChannelComposerState(activeChat);
                        }
                    }).catch(() => { statusEl.textContent = ''; });
            } else if (activeChat && activeChat.type === 'group') {
                statusEl.style.color = 'var(--text-muted)';
                fetch('/api/v1/chats/' + id + '/members-online', {
                    headers: { 'Authorization': 'Bearer ' + token }
                }).then(r => r.ok ? r.json() : null).then(data => {
                    if (data && data.total > 0) {
        statusEl.textContent = (window.i18n?.tc ? window.i18n.tc('membersCount', data.total) : (data.total + ' ' + pluralMembers(data.total))) + (data.online > 0 ? ', ' + data.online + ' ' + (window.i18n?.t('online') || 'онлайн') : '');
                        statusEl.style.color = 'var(--text-muted)';
                    }
                }).catch(() => { statusEl.textContent = ''; });
            } else {
                statusEl.textContent = '';
            }
            
            // Инициализируем view элементы
            const topicsArea = document.getElementById('topicsArea');
            const messagesArea = document.getElementById('messagesArea');
            const inputArea = document.getElementById('mainInputArea');
            const replyBar = document.getElementById('replyBar');
            const chatBackBtn = document.getElementById('chatBackBtn');
            const topicsBackBtn = document.getElementById('topicsBackBtn');
            const closedBar = document.getElementById('topicClosedBar');

            if (closedBar) closedBar.style.display = 'none';

            if (activeChat.isSupergroup) {
                if (topicId !== undefined && topicId !== null) {
                    // Переходим сразу в тему
                    activeTopic = null;
                    if (topicsArea) topicsArea.style.display = 'none';
                    if (messagesArea) messagesArea.style.display = 'flex';
                    if (inputArea) inputArea.style.display = 'flex';
                    if (chatBackBtn) chatBackBtn.style.display = 'none';
                    if (topicsBackBtn) topicsBackBtn.style.display = 'block';

                    fetch(`/api/v1/chats/${activeChat.id}/topics`, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    }).then(r => r.ok ? r.json() : {topics: []}).then(data => {
                        const found = data.topics.find(t => t.id === topicId);
                        if (found) {
                            selectTopic(found.id, found.title, found.icon_emoji, found.icon_color, found.is_closed);
                        } else if (topicId === 'null') {
                            selectTopic(null, 'Общий', '💬', '#9d00ff', false);
                        } else {
                            selectTopic(null, 'Общий', '💬', '#9d00ff', false);
                        }
                    }).catch(() => {
                        selectTopic(null, 'Общий', '💬', '#9d00ff', false);
                    });
                } else {
                    // Скрываем сообщения, инпут, показываем сетку тем
                    activeTopic = null;
                    if (topicsArea) topicsArea.style.display = 'flex';
                    if (messagesArea) messagesArea.style.display = 'none';
                    if (inputArea) inputArea.style.display = 'none';
                    if (replyBar) replyBar.style.display = 'none';
                    if (chatBackBtn) chatBackBtn.style.display = 'block';
                    if (topicsBackBtn) topicsBackBtn.style.display = 'none';
                    
                    statusEl.textContent = 'Темы группы';
                    loadTopics();
                }
            } else {
                // Показываем обычную переписку
                activeTopic = null;
                if (topicsArea) topicsArea.style.display = 'none';
                if (messagesArea) messagesArea.style.display = 'flex';
                if (inputArea && activeChat.type !== 'channel') {
                    inputArea.style.display = 'flex';
                }
                if (chatBackBtn) chatBackBtn.style.display = 'block';
                if (topicsBackBtn) topicsBackBtn.style.display = 'none';

                loadMessages();
                loadPinnedMessage(id);

                if (activeChat.type === 'channel' && typeof window.applyChannelComposerState === 'function' && activeChat.channelMeta) {
                    window.applyChannelComposerState(activeChat);
                }
            }

            // E2E: инициализируем ключ для чата и показываем индикатор
            if (window.E2E) {
                window.E2E.getSessionKey(id, token).then(key => {
                    const ind = document.getElementById('e2eIndicator');
                    if (ind) ind.style.display = key ? 'flex' : 'none';
                }).catch(() => {});
            }

            // Восстанавливаем черновик
            if (saveDrafts) {
                const draft = localStorage.getItem('crane_draft_' + id) || '';
                document.getElementById('msgInput').innerText = draft;
            }

            // Применяем autoplay GIF
            const autoplayGifs = advSettings.autoplayGifs !== false;
            document.querySelectorAll('img[src$=".gif"]').forEach(img => {
                img.style.animationPlayState = autoplayGifs ? 'running' : 'paused';
            });
        }

        async function updateChatUserStatus(userId) {
            if (!userId) return;

            const statusEl = document.getElementById('chatStatus');

            // Если это бот — показываем "бот" вместо статуса
            const chatUser = chatUsers[activeChat && activeChat.id];
            if (chatUser && chatUser.isBot) {
                statusEl.textContent = tr('bot', 'bot');
                statusEl.style.color = 'var(--accent-color)';
                return;
            }

            try {
                const res = await fetch('/api/v1/users/' + userId + '/status', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                
                statusEl.textContent = chatStatusText({ isOnline: data.isOnline, lastSeen: data.lastSeen });
                statusEl.style.color = data.isOnline ? 'var(--success-color)' : 'var(--text-muted)';
            } catch (e) {
                statusEl.textContent = '';
            }
        }

        function closeChat() {
            if (typeof window.closeChannelCommentsView === 'function') {
                window.closeChannelCommentsView();
            }
            if (activeChat) {
                delete mentionJumpCursorByChat[activeChat.id];
            }
            activeChat = null;
            setScrollBottomButtonEnabled(false);
            setMentionJumpButtonEnabled(false);
            renderChatList();

            document.getElementById('sidebar').classList.remove('hidden');
            document.body.classList.remove('chat-open');

            document.getElementById('noChat').style.display = 'flex';
            document.getElementById('chatView').classList.remove('active');
            cancelReply();
        }

        let _messagesLayoutBatchDepth = 0;

        function beginMessagesLayoutBatch() {
            _messagesLayoutBatchDepth++;
        }

        function endMessagesLayoutBatch(scrollAfter) {
            if (_messagesLayoutBatchDepth > 0) _messagesLayoutBatchDepth--;
            if (_messagesLayoutBatchDepth === 0) {
                requestAnimationFrame(function() {
                    if (scrollAfter) scrollToBottom();
                    refreshScrollBottomObserver();
                    updateMentionJumpButton();
                });
            }
        }

        function renderMessagesChunked(messages, container, chunkSize) {
            return new Promise(function(resolve) {
                let index = 0;
                function appendChunk() {
                    if (!activeChat || index >= messages.length) {
                        resolve();
                        return;
                    }
                    const frag = document.createDocumentFragment();
                    const end = Math.min(index + chunkSize, messages.length);
                    for (; index < end; index++) {
                        frag.appendChild(createMessageElement(messages[index]));
                    }
                    container.appendChild(frag);
                    if (index < messages.length) {
                        requestAnimationFrame(appendChunk);
                    } else {
                        resolve();
                    }
                }
                requestAnimationFrame(appendChunk);
            });
        }

        // ============================================
        // MESSAGES
        // ============================================
        async function loadMessages(chatIdParam, topicIdParam) {
            if (!activeChat) return;
            const chatId = chatIdParam || activeChat.id;
            
            const messagesEl = document.getElementById('messages');
            messagesEl.innerHTML = '';
            
            try {
                let url = '/api/v1/messages/' + chatId;
                let topicId = null;
                if (topicIdParam !== undefined) {
                    topicId = topicIdParam;
                } else if (activeTopic) {
                    topicId = activeTopic.id;
                }
                
                if (topicId !== null) {
                    url += '?topicId=' + topicId;
                } else if (activeChat.isSupergroup) {
                    url += '?topicId=null';
                }

                const res = await fetch(url, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                if (!activeChat || activeChat.id !== chatId) return;
                
                if (data.messages && data.messages.length > 0) {
                    // Расшифровываем сообщения если E2E включён
                    const messages = await Promise.all(data.messages.map(async m => {
                        if (m.isEncrypted && m.encryptionIv && window.E2E) {
                            try {
                                const dec = await window.E2E.decrypt(m.content, m.encryptionIv, activeChat.id, token);
                                if (dec === '🔒 [зашифровано]' && m.contentPlain) {
                                    m.content = m.contentPlain;
                                } else {
                                    m.content = dec;
                                }
                                m._isDecrypted = true;
                            } catch (_) {}
                        }
                        // Расшифровываем replyToContent
                        if (m.replyToEncrypted && m.replyToIv && window.E2E) {
                            try {
                                const decReply = await window.E2E.decrypt(m.replyToContent, m.replyToIv, activeChat.id, token);
                                if (decReply !== '🔒 [зашифровано]') {
                                    m.replyToContent = decReply;
                                }
                            } catch (_) {}
                        }
                        return m;
                    }));
                    messages.forEach(function(m) {
                        messagesData[m.id] = m;
                        if (m.type === 'poll' && m.poll) {
                            rememberPollPayload(m.id, m.poll);
                        }
                    });

                    const useChunkedRender = messages.length > 30;
                    beginMessagesLayoutBatch();
                    if (useChunkedRender) {
                        await renderMessagesChunked(messages, messagesEl, 15);
                    } else {
                        const frag = document.createDocumentFragment();
                        messages.forEach(function(m) {
                            frag.appendChild(createMessageElement(m));
                        });
                        messagesEl.appendChild(frag);
                    }
                    endMessagesLayoutBatch(true);
                    decryptMessagesInBackground(chatId, messages);
                    hydratePollsInChat(chatId, messages);
                } else {
                    messagesEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:14px;">' + tr('noMessages', 'Нет сообщений') + '</div>';
                }
                refreshMentionPendingFromLoadedMessages(chatId);
                if (!data.messages || !data.messages.length) {
                    scrollToBottom();
                    refreshScrollBottomObserver();
                    updateMentionJumpButton();
                }
                renderChatList();
                markChatAsRead(chatId, { silent: true }).catch(function(err) {
                    console.error('Mark chat as read error:', err);
                });
            } catch (err) {
                console.error('Load messages error:', err);
            }
        }

                // ============================================
        // CONTEXT MENU
        // ============================================
        // Проверка, является ли ID валидным UUID (а не временным ID)
        function isValidUUID(id) {
            if (!id || typeof id !== 'string') return false;
            // UUID имеет формат xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
            // или не начинается с "temp-"
            return !id.startsWith('temp-') && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        }

        function showMessageContextMenu(e, messageId, element, text, senderName) {
            // Для pending сообщений показываем только копирование
            if (!isValidUUID(messageId)) {
                currentMessageId = messageId;
                currentMessageElement = element;
                // Показываем упрощённое меню только с копированием
                const menu = document.getElementById('messageContextMenu');
                const x = e.pageX || (e.touches && e.touches[0].pageX) || e.clientX || 0;
                const y = e.pageY || (e.touches && e.touches[0].pageY) || e.clientY || 0;
                menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
                menu.style.top = Math.min(y, window.innerHeight - 250) + 'px';
                // Скрываем все кроме копирования
                menu.querySelectorAll('.context-menu-item').forEach(item => {
                    item.style.display = item.onclick && item.onclick.toString().includes('copyMessageText') ? 'flex' : 'none';
                });
                menu.classList.add('active');
                return;
            }

            // Восстанавливаем все пункты меню
            document.getElementById('messageContextMenu').querySelectorAll('.context-menu-item').forEach(item => {
                item.style.display = '';
            });
            
            currentMessageId = messageId;
            currentMessageElement = element;

            // Показываем кнопку скачать только для фото/гифок
            const msg = messagesData[messageId];
            const downloadItem = document.getElementById('downloadMediaItem');
            const copyItem = document.getElementById('copyTextItem');
            const copyLabel = document.getElementById('copyItemLabel');
            const isMedia = msg && (msg.type === 'image' || msg.type === 'photo' || msg.type === 'gif');
            if (downloadItem) downloadItem.style.display = isMedia ? 'flex' : 'none';
        if (copyLabel) copyLabel.textContent = isMedia ? (window.i18n?.t('copyPhoto') || 'Скопировать фото') : (window.i18n?.t('copyText') || 'Копировать текст');
            if (copyItem) copyItem.onclick = isMedia ? copyMessagePhoto : copyMessageText;

            // Настраиваем пункт закрепления (Закрепить / Открепить)
            const pinItem = document.getElementById('pinMessageText')?.parentNode;
            const pinTextSpan = document.getElementById('pinMessageText');
            if (pinItem && pinTextSpan) {
                // Если это группа, закреплять может только создатель (владелец) чата
                if (activeChat && activeChat.type === 'group' && activeChat.role !== 'owner') {
                    pinItem.style.display = 'none';
                } else {
                    pinItem.style.display = 'flex';
                    const isPinned = msg && (msg.isPinned || msg.pinned || element.classList.contains('pinned'));
                    if (isPinned) {
                        pinTextSpan.textContent = tr('unpinMessage', 'Открепить');
                        pinItem.onclick = unpinMessage;
                    } else {
                        pinTextSpan.textContent = tr('pinMessage', 'Закрепить');
                        pinItem.onclick = pinMessage;
                    }
                }
            }
            
            const menu = document.getElementById('messageContextMenu');
            const x = e.pageX || (e.touches && e.touches[0].pageX) || e.clientX || 0;
            const y = e.pageY || (e.touches && e.touches[0].pageY) || e.clientY || 0;
            
            // Сначала показываем меню чтобы получить его размеры
            menu.style.visibility = 'hidden';
            menu.style.display = 'block';
            const menuW = menu.offsetWidth || 220;
            const menuH = menu.offsetHeight || 300;
            menu.style.display = '';
            menu.style.visibility = '';

            // Позиционируем с учётом границ экрана
            let left = x;
            let top = y;

            // Не выходим за правый край
            if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
            if (left < 8) left = 8;

            // Не выходим за нижний край — показываем выше курсора
            if (top + menuH > window.innerHeight - 8) {
                top = y - menuH;
            }
            if (top < 8) {
                top = 8;
            }

            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
            menu.style.maxHeight = (window.innerHeight - 16) + 'px';
            menu.style.overflowY = 'auto';
            menu.classList.add('active');
            
            const isSender = element.classList.contains('outgoing');
            const deleteForAll = menu.querySelector('.context-menu-item.danger');
            if (deleteForAll) {
                deleteForAll.style.display = isSender ? 'flex' : 'none';
            }
            // Редактировать можно только свои сообщения (не бота)
            const editItem = menu.querySelector('.context-menu-item[onclick="editMessage()"]');
            const msgData = messagesData[currentMessageId];
            const isBotMessage = msgData && (msgData.senderUsername === 'craneapp_bot' || msgData.isBot === true);
            const isOwnMessage = msgData && (msgData.senderId === user.id || msgData.outgoing) && !isBotMessage;
            if (editItem) editItem.style.display = isOwnMessage ? 'flex' : 'none';

            // Подсвечиваем уже поставленные реакции
            updateContextMenuReactions(messageId);
        }

        document.addEventListener('click', function(e) {
            const menu = document.getElementById('messageContextMenu');
            // Не закрываем если клик внутри меню
            if (menu.contains(e.target)) return;
            menu.classList.remove('active');
            // Сбрасываем расширенные реакции
            const reactionsRow = document.getElementById('contextReactions');
            if (reactionsRow) {
                reactionsRow.classList.remove('expanded');
                reactionsRow.querySelectorAll('.context-reaction-extra').forEach(el => el.remove());
                const moreBtn = reactionsRow.querySelector('.context-reaction-more');
                if (moreBtn) moreBtn.textContent = '＋';
            }
        });

        function replyToMessage() {
            // Проверка что messageId валиден
            if (!isValidUUID(currentMessageId)) {
                showToast('info', 'Сообщение ещё отправляется...', '⏳');
                return;
            }
            document.getElementById('messageContextMenu').classList.remove('active');
            const msg = messagesData[currentMessageId];
            const name = msg && (msg.senderName || msg.senderFirstName) || tr('user', 'Пользователь');
            const text = msg && (msg.content || msg.text) || '';
            setReplyTo(currentMessageId, name, text);
        }

        function editMessage() {
            // Проверка что messageId валиден
            if (!isValidUUID(currentMessageId)) {
                showToast('info', 'Сообщение ещё отправляется...', '⏳');
                return;
            }
            document.getElementById('messageContextMenu').classList.remove('active');
            document.getElementById('editMessageText').value = currentMessageElement.querySelector('.message-text').textContent;
            document.getElementById('editMessageModal').classList.add('active');
            setTimeout(function() {
                document.getElementById('editMessageText').focus();
            }, 100);
        }

        function closeEditMessageModal() {
            document.getElementById('editMessageModal').classList.remove('active');
        }

        function saveEditedMessage() {
            const newText = document.getElementById('editMessageText').value.trim();
            if (!newText) {
                showToast('error', 'Введите текст', '⚠️');
                return;
            }
            
            // Проверка что messageId валиден
            if (!isValidUUID(currentMessageId)) {
                showToast('error', 'Сообщение ещё отправляется', '⚠️');
                return;
            }
            
            fetch('/api/v1/messages/' + currentMessageId, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ content: newText })
            }).then(function(r) { return r.json(); }).then(function(d) {
                if (d.success) {
                    currentMessageElement.querySelector('.message-text').innerHTML = renderFormattedText(newText);
                    closeEditMessageModal();
                    showToast('success', 'Сохранено', '✓');
                } else {
                    showToast('error', d.error || 'Ошибка', '❌');
                }
            }).catch(function(err) {
                showToast('error', 'Ошибка сохранения', '❌');
            });
        }
                
        function deleteMessage(forEveryone) {
            // Проверка что messageId валиден
            if (!isValidUUID(currentMessageId)) {
                showToast('info', 'Сообщение ещё отправляется...', '⏳');
                return;
            }
            document.getElementById('messageContextMenu').classList.remove('active');
            
            document.getElementById('confirmTitle').textContent = forEveryone ? (window.i18n?.t('deleteForEveryoneQuestion') || 'Удалить для всех?') : (window.i18n?.t('deleteQuestion') || 'Удалить?');
            document.getElementById('confirmText').textContent = 'Это действие нельзя отменить.';
            
            document.getElementById('confirmBtn').onclick = function() {
                performDelete(forEveryone);
                closeConfirmModal();
            };
            
            document.getElementById('confirmModal').classList.add('active');
        }

        async function performDelete(forEveryone) {
            // Проверка что messageId валиден
            if (!isValidUUID(currentMessageId)) {
                showToast('error', 'Сообщение ещё отправляется', '⚠️');
                return;
            }
            try {
                const res = await fetch('/api/v1/messages/' + currentMessageId + '?forEveryone=' + forEveryone, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    removeMessage(currentMessageId);
                    showToast('success', 'Удалено', '✓');
                }
            } catch (err) {
                showToast('error', 'Ошибка', '❌');
            }
        }

        // ============================================
        // PIN MESSAGE
        // ============================================
        // Обновляем handleWsMessage для обработки событий закрепления
        function copyMessageText() {
            // Проверка что messageId валиден
            if (!isValidUUID(currentMessageId)) {
                showToast('info', 'Сообщение ещё отправляется...', '⏳');
                return;
            }
            document.getElementById('messageContextMenu').classList.remove('active');
            const text = currentMessageElement.querySelector('.message-text').textContent;
            navigator.clipboard.writeText(text);
            showToast('success', 'Скопировано', '📋');
        }

        // ============================================
        // PIN MESSAGE
        // ============================================
        let currentPinnedMessage = null;
        let pinnedMessages = [];
        let currentPinnedIndex = 0;

        async function pinMessage() {
            document.getElementById('messageContextMenu').classList.remove('active');
            
            if (!currentMessageId || !currentMessageElement) return;
            
            try {
                const res = await fetch('/api/v1/messages/' + currentMessageId + '/pin', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await res.json();
                
                if (res.ok && data.success) {
                    // Добавляем визуальный индикатор
                    currentMessageElement.classList.add('pinned');
                    
                    // Обновляем кэш
                    if (messagesData[currentMessageId]) {
                        messagesData[currentMessageId].isPinned = true;
                    }
                    
                    // Добавляем в массив закрепленных (в начало — самое свежее)
                    if (!pinnedMessages.find(m => m.id === data.message.id)) {
                        pinnedMessages.unshift(data.message);
                    }
                    currentPinnedIndex = 0;
                    
                    // Обновляем UI - показываем закрепленное сообщение
                    showPinnedMessage(pinnedMessages[0]);
                    
                    showToast('success', 'Сообщение закреплено', '📌');
                } else {
                    showToast('error', data.error || 'Ошибка', '❌');
                }
            } catch (err) {
                console.error('Pin error:', err);
                showToast('error', 'Ошибка закрепления', '❌');
            }
        }

        async function unpinMessage() {
            const messageIdToUnpin = currentMessageId || (currentPinnedMessage && currentPinnedMessage.id);
            if (!messageIdToUnpin) return;
            document.getElementById('messageContextMenu').classList.remove('active');
            
            try {
                const res = await fetch('/api/v1/messages/' + messageIdToUnpin + '/pin', {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await res.json();
                if (res.ok && data.success) {
                    // Убираем визуальный индикатор
                    const msgEl = document.querySelector('[data-message-id="' + messageIdToUnpin + '"]');
                    if (msgEl) {
                        msgEl.classList.remove('pinned');
                    }
                    if (messagesData[messageIdToUnpin]) {
                        messagesData[messageIdToUnpin].isPinned = false;
                    }
                    
                    // Убираем из массива закрепленных
                    pinnedMessages = pinnedMessages.filter(m => m.id !== messageIdToUnpin);
                    if (pinnedMessages.length === 0) {
                        currentPinnedIndex = 0;
                        hidePinnedMessage();
                    } else {
                        if (currentPinnedIndex >= pinnedMessages.length) currentPinnedIndex = 0;
                        showPinnedMessage(pinnedMessages[currentPinnedIndex]);
                    }
                    
                    showToast('success', 'Сообщение откреплено', '📌');
                } else {
                    showToast('error', data.error || 'Ошибка', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка', '❌');
            }
        }

        async function showPinnedMessage(msg) {
            if (msg.isEncrypted && msg.encryptionIv && window.E2E && !msg._isDecrypted) {
                try {
                    const decrypted = await window.E2E.decrypt(msg.content, msg.encryptionIv, activeChat.id, token);
                    if (decrypted && decrypted !== '🔒 [зашифровано]') {
                        msg.content = decrypted;
                        msg._isDecrypted = true;
                    }
                } catch (_) {}
            }
            currentPinnedMessage = msg;
            
            // Используем новую панельку в header
            const barEl = document.getElementById('pinnedMessageBar');
            const textEl = document.getElementById('pinnedMessageBarText');
            
            if (!barEl || !textEl) {
                // Если панельки нет, создаем её
                createPinnedMessageBar();
            }
            
            const pinnedBar = document.getElementById('pinnedMessageBar');
            const pinnedText = document.getElementById('pinnedMessageBarText');
            
            let mediaIcon = '📷';
            if (msg.type === 'video') mediaIcon = '🎬';
            else if (msg.type === 'gif') mediaIcon = '🎞';
            else if (msg.type === 'sticker') mediaIcon = '🎨';
            else if (msg.type === 'voice') mediaIcon = '🎙️';
            
            let prefix = '<span>📌</span> ';
            if (pinnedMessages && pinnedMessages.length > 1) {
                const total = pinnedMessages.length;
                const current = currentPinnedIndex + 1;
                prefix = `<span>📌</span> <span class="pinned-counter">(${current}/${total})</span> `;
            }
            
            let contentText = '';
            const senderName = escapeHtml(msg.senderFirstName || msg.senderUsername || window.i18n?.t('you') || 'Вы');
            if (msg.type === 'image' || msg.type === 'photo') {
                contentText = `<span>${mediaIcon}</span> ` + senderName + ': Фото';
            } else if (msg.type === 'video') {
                contentText = `<span>${mediaIcon}</span> ` + senderName + ': Видео';
            } else if (msg.type === 'gif') {
                contentText = `<span>${mediaIcon}</span> ` + senderName + ': GIF';
            } else if (msg.type === 'sticker') {
                contentText = `<span>${mediaIcon}</span> ` + senderName + ': Стикер';
            } else {
                const text = escapeHtml(msg.content || '');
                contentText = '<strong>' + senderName + ':</strong> ' + (text.length > 60 ? text.substring(0, 60) + '...' : text);
            }
            
            pinnedText.innerHTML = prefix + contentText;
            
            if (pinnedBar) {
                pinnedBar.style.display = '';
                pinnedBar.classList.add('active');
            }
            
            // Настраиваем кнопку скрытия/открепления (крестик)
            const closeBtn = pinnedBar.querySelector('.pinned-message-bar-close');
            if (closeBtn) {
                // В группах скрываем крестик для не-владельцев
                if (activeChat && activeChat.type === 'group' && activeChat.role !== 'owner') {
                    closeBtn.style.display = 'none';
                } else {
                    closeBtn.style.display = 'block';
                }
            }
            
            // Также обновляем старую панель (если есть)
            const container = document.getElementById('pinnedMessageContainer');
            if (container) {
                const contentEl = document.getElementById('pinnedMessageContent');
                if (contentEl) {
                    contentEl.innerHTML = pinnedText.innerHTML;
                }
                container.classList.add('active');
            }
        }

        function hidePinnedMessage() {
            currentPinnedMessage = null;
            // Скрываем новую панельку в header
            const barEl = document.getElementById('pinnedMessageBar');
            if (barEl) {
                barEl.classList.remove('active');
                barEl.style.display = 'none';
            }
            
            // Также скрываем старую панель (если есть)
            const container = document.getElementById('pinnedMessageContainer');
            if (container) {
                container.classList.remove('active');
                container.style.display = 'none';
            }
        }

        async function hidePinnedMessageBar(e) {
            if (e && typeof e.stopPropagation === 'function') {
                e.stopPropagation();
            } else if (window.event && typeof window.event.stopPropagation === 'function') {
                window.event.stopPropagation();
            }
            if (!currentPinnedMessage) return;
            
            // В группах откреплять может только создатель (владелец) чата
            if (activeChat && activeChat.type === 'group' && activeChat.role !== 'owner') {
                hidePinnedMessage();
                return;
            }
            
            if (confirm('Открепить это сообщение для всех участников?')) {
                try {
                    const unpinId = currentPinnedMessage.id;
                    const res = await fetch('/api/v1/messages/' + unpinId + '/pin', {
                        method: 'DELETE',
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                        // Убираем визуальный класс с сообщения
                        const msgEl = document.querySelector('[data-message-id="' + unpinId + '"]');
                        if (msgEl) msgEl.classList.remove('pinned');
                        if (messagesData[unpinId]) {
                            messagesData[unpinId].isPinned = false;
                        }
                        
                        // Убираем из массива закрепленных
                        pinnedMessages = pinnedMessages.filter(m => m.id !== unpinId);
                        if (pinnedMessages.length === 0) {
                            currentPinnedIndex = 0;
                            hidePinnedMessage();
                        } else {
                            if (currentPinnedIndex >= pinnedMessages.length) currentPinnedIndex = 0;
                            showPinnedMessage(pinnedMessages[currentPinnedIndex]);
                        }
                        
                        showToast('success', 'Сообщение откреплено', '📌');
                    } else {
                        showToast('error', data.error || 'Ошибка', '❌');
                        hidePinnedMessage(); // Force hide locally even on error if it fails
                    }
                } catch (err) {
                    console.error('Failed to unpin message:', err);
                    hidePinnedMessage(); // Force hide locally
                }
            }
        }

        function createPinnedMessageBar() {
            const chatView = document.getElementById('chatView');
            if (!chatView) return;
            
            // Проверяем, существует ли уже панель
            if (document.getElementById('pinnedMessageBar')) return;
            
            const chatHeader = document.getElementById('chatHeader');
            if (!chatHeader) return;
            
            const bar = document.createElement('div');
            bar.id = 'pinnedMessageBar';
            bar.className = 'pinned-message-bar';
            bar.setAttribute('onclick', 'openPinnedMessage()');
            bar.innerHTML = 
                '<div class="pinned-message-bar-text" id="pinnedMessageBarText">Закрепленное сообщение</div>' +
                '<button class="pinned-message-bar-close" onclick="hidePinnedMessageBar(event)">×</button>';
            
            chatHeader.parentNode.insertBefore(bar, chatHeader.nextSibling);
        }

        function createPinnedMessageContainer() {
            const chatHeader = document.getElementById('chatHeader');
            if (!chatHeader) return;
            
            const pinnedEl = document.createElement('div');
            pinnedEl.id = 'pinnedMessageContainer';
            pinnedEl.className = 'pinned-message-container';
            pinnedEl.innerHTML = 
                '<div id="pinnedMessageContent" onclick="openPinnedMessage()"></div>' +
                '<button class="pinned-close-btn" onclick="hidePinnedMessage()">✕</button>';
            
            chatHeader.parentNode.insertBefore(pinnedEl, chatHeader.nextSibling);
        }

        function openPinnedMessage() {
            if (!pinnedMessages || pinnedMessages.length === 0) return;
            
            const msg = pinnedMessages[currentPinnedIndex];
            if (!msg) return;
            
            // Прокрутка к закрепленному сообщению
            const pinnedMsgEl = document.querySelector('[data-message-id="' + msg.id + '"]');
            if (pinnedMsgEl) {
                pinnedMsgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                pinnedMsgEl.classList.add('highlight');
                setTimeout(function() {
                    pinnedMsgEl.classList.remove('highlight');
                }, 2000);
            } else {
                showToast('info', 'Сообщение находится выше по истории', '📌');
            }
            
            // Если закрепленных сообщений несколько, переключаем на следующее для следующего клика
            if (pinnedMessages.length > 1) {
                currentPinnedIndex = (currentPinnedIndex + 1) % pinnedMessages.length;
                showPinnedMessage(pinnedMessages[currentPinnedIndex]);
            }
        }

        // Загрузить закрепленное сообщение при открытии чата
        async function loadPinnedMessage(chatId) {
            try {
                const res = await fetch('/api/v1/chats/' + chatId + '/pinned', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await res.json();
                
                // Инициализируем массив закрепленных сообщений
                pinnedMessages = data.messages || [];
                currentPinnedIndex = 0;
                
                if (pinnedMessages.length > 0) {
                    showPinnedMessage(pinnedMessages[0]);
                    
                    // Добавляем класс pinned всем закрепленным сообщениям в текущем виде
                    pinnedMessages.forEach(m => {
                        const msgEl = document.querySelector('[data-message-id="' + m.id + '"]');
                        if (msgEl) {
                            msgEl.classList.add('pinned');
                        }
                    });
                } else {
                    hidePinnedMessage();
                }
            } catch (err) {
                console.error('Load pinned error:', err);
            }
        }

        // Обновляем handleWsMessage для обработки событий закрепления
        function copyMessageText() {
            document.getElementById('messageContextMenu').classList.remove('active');
            const text = currentMessageElement.querySelector('.message-text').textContent;
            navigator.clipboard.writeText(text);
            showToast('success', 'Скопировано', '📋');
        }

        // ============================================
        // TEXT FORMATTING
        // ============================================
        function formatSelectedText(format) {
            document.getElementById('messageContextMenu').classList.remove('active');
            
            const input = document.getElementById('msgInput');
            const selection = window.getSelection();
            
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                showToast('info', 'Выделите текст для форматирования', '⚠️');
                return;
            }
            
            const selectedText = selection.toString();
            let prefix = '', suffix = '';
            
            switch (format) {
                case 'bold': prefix = '**'; suffix = '**'; break;
                case 'italic': prefix = '_'; suffix = '_'; break;
                case 'underline': prefix = '__'; suffix = '__'; break;
                case 'strikethrough': prefix = '~~'; suffix = '~~'; break;
                case 'monospace': prefix = '`'; suffix = '`'; break;
                case 'spoiler': prefix = '||'; suffix = '||'; break;
                case 'quote':
                    document.execCommand('insertText', false, selectedText.split('\n').map(function(line) {
                        return '> ' + line;
                    }).join('\n'));
                    input.focus();
                    return;
            }

            document.execCommand('insertText', false, prefix + selectedText + suffix);
            input.focus();
        }

        function applyInlineFormatting(escaped) {
            escaped = escaped.replace(/`([^`\n]+?)`/g, '<code class="mono">$1</code>');
            escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<span class="bold">$1</span>');
            escaped = escaped.replace(/__(.+?)__/g, '<span class="underline">$1</span>');
            escaped = escaped.replace(/_(.+?)_/g, '<span class="italic">$1</span>');
            escaped = escaped.replace(/~~(.+?)~~/g, '<span class="strikethrough">$1</span>');
            escaped = escaped.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');
            return escaped;
        }

        // Функция для рендеринга форматированного текста в сообщениях
        function renderFormattedText(text) {
            if (!text) return '';

            const lines = String(text).split('\n');
            const rendered = lines.map(function(line) {
                const quoteMatch = line.match(/^>\s?(.*)$/);
                const escaped = (quoteMatch ? quoteMatch[1] : line)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                const formatted = applyInlineFormatting(escaped);
                if (quoteMatch) {
                    return '<blockquote class="msg-quote">' + formatted + '</blockquote>';
                }
                return formatted;
            });

            let escaped = rendered.join('<br>');

            // 1. Обрабатываем полные ссылки http(s)://...
            escaped = escaped.replace(/(https?:\/\/[^\s<]+)/gi, function(url) {
                const joinMatch = url.match(/(?:\/)?\bjoin\/([a-zA-Z0-9]{8,20})\b/i);
                if (joinMatch) {
                    const code = joinMatch[1];
                    return `<a href="#" onclick="event.preventDefault(); window.handleInviteLinkClick('${code}');" class="chat-join-link">${url}</a>`;
                }
                return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
            });

            // 2. Обрабатываем короткие ссылки вида join/код или /join/код
            escaped = escaped.replace(/(?<![a-zA-Z0-9="])\/?\bjoin\/([a-zA-Z0-9]{8,20})\b/gi, function(full, code) {
                return `<a href="#" onclick="event.preventDefault(); window.handleInviteLinkClick('${code}');" class="chat-join-link">${full}</a>`;
            });

            if (escaped.includes('@')) {
                escaped = renderMentionsInText(escaped);
            }
            
            return escaped;
        }
        window.renderFormattedText = renderFormattedText;

        function isMentionRelevantToMe(tagLower) {
            if (tagLower === 'everyone') return true;
            if (tagLower === 'here') return currentUserGroupOnline;
            const myUsername = (user.username || '').toLowerCase();
            return tagLower === myUsername;
        }

        function renderMentionsInText(escaped) {
            const isGroup = activeChat && activeChat.type === 'group';
            return escaped.replace(/@([a-zA-Z0-9_]+)/g, function(full, name) {
                const lower = name.toLowerCase();
                if (!isGroup && lower !== 'here' && lower !== 'everyone') {
                    const myUsername = (user.username || '').toLowerCase();
                    if (lower !== myUsername) return full;
                }
                const isMe = isMentionRelevantToMe(lower);
                const cls = 'message-mention' + (isMe ? ' message-mention-me' : '');
                return '<span class="' + cls + '">' + full + '</span>';
            });
        }

        // ============================================
        // FORWARD MESSAGE
        // ============================================
        let forwardMessageData = null;

        function openForwardModal() {
            document.getElementById('messageContextMenu').classList.remove('active');
            
            const msg = messagesData[currentMessageId];
            if (!msg) return;
            
            forwardMessageData = {
                content: msg.content || msg.text || '',
                type: msg.type,
                mediaUrl: msg.mediaUrl,
                senderName: msg.senderFirstName || msg.sender?.firstName || msg.senderName || 'Пользователь'
            };
            
            // Показываем превью сообщения
            const previewEl = document.getElementById('forwardPreview');
            if (forwardMessageData.type === 'image' || forwardMessageData.type === 'photo') {
                previewEl.innerHTML = '<img src="' + forwardMessageData.mediaUrl + '" style="max-width: 60px; max-height: 60px; border-radius: 8px; vertical-align: middle; margin-right: 8px;"> <span>Фото</span>';
            } else if (forwardMessageData.type === 'video') {
                previewEl.innerHTML = '<span>🎬</span> <span>Видео</span>';
            } else if (forwardMessageData.type === 'gif') {
                previewEl.innerHTML = '<span>🎞</span> <span>GIF</span>';
            } else if (forwardMessageData.type === 'sticker') {
                previewEl.innerHTML = '<span>🎨</span> <span>Стикер</span>';
            } else {
                previewEl.innerHTML = '<strong>' + escapeHtml(forwardMessageData.senderName) + ':</strong> ' + escapeHtml(forwardMessageData.content.substring(0, 100) || 'Текстовое сообщение');
            }
            
            // Загружаем список чатов
            renderForwardChatsList();
            
            document.getElementById('forwardModal').classList.add('active');
            
            // Добавляем обработчик поиска
            setTimeout(function() {
                document.getElementById('forwardSearchInput').focus();
            }, 100);
        }

        function closeForwardModal() {
            document.getElementById('forwardModal').classList.remove('active');
            document.getElementById('forwardSearchInput').value = '';
            document.getElementById('forwardChatsList').innerHTML = '';
            forwardMessageData = null;
        }

        function renderForwardChatsList(filter) {
            const listEl = document.getElementById('forwardChatsList');
            filter = (filter || '').toLowerCase();
            
            // Объединяем обычные и архивные чаты
            let allChatsForForward = [...allChats];
            
            // Добавляем архивные чаты, которых нет в обычном списке
            archivedChats.forEach(function(ac) {
                if (!allChatsForForward.some(function(c) { return c.id === ac.id; })) {
                    allChatsForForward.push(ac);
                }
            });
            
            // Фильтруем
            let filteredChats = allChatsForForward;
            if (filter) {
                filteredChats = allChatsForForward.filter(function(c) {
                    return c.name && c.name.toLowerCase().indexOf(filter) >= 0;
                });
            }
            
            if (filteredChats.length === 0) {
                listEl.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);">' + tr('noChats', 'Нет чатов') + '</div>';
                return;
            }
            
            listEl.innerHTML = filteredChats.map(function(c) {
                const ph = typeof c.av === 'string' && c.av.length <= 2 ? c.av : (c.name ? c.name[0] : '?');
                return '<div class="forward-chat-item" onclick="forwardToChat(\'' + c.id + '\', \'' + c.name + '\')">' +
                    renderAvatar(c.av, ph, 'avatar', c.isBot ? 'craneapp_bot' : '', c.name) +
                    '<div class="forward-chat-info">' +
                    '<div class="forward-chat-name">' + c.name + '</div>' +
                    '<div class="forward-chat-last">' + (c.lastMessage || tr('noMessages', 'Нет сообщений')) + '</div>' +
                    '</div>' +
                    '</div>';
            }).join('');
        }

        async function forwardToChat(chatId, chatName) {
            if (!forwardMessageData) return;
            
            try {
                let messageContent = '';
                let messageType = 'text';
                let mediaUrl = null;
                
                if (forwardMessageData.type === 'image' || forwardMessageData.type === 'photo') {
                    messageType = 'image';
                    mediaUrl = forwardMessageData.mediaUrl;
                    messageContent = 'Фото';
                } else if (forwardMessageData.type === 'video') {
                    messageType = 'video';
                    mediaUrl = forwardMessageData.mediaUrl;
                    messageContent = 'Видео';
                } else if (forwardMessageData.type === 'gif') {
                    messageType = 'gif';
                    mediaUrl = forwardMessageData.mediaUrl;
                    messageContent = 'GIF';
                } else if (forwardMessageData.type === 'sticker') {
                    messageType = 'sticker';
                    mediaUrl = forwardMessageData.mediaUrl;
                    messageContent = 'Стикер';
                } else {
                    messageContent = forwardMessageData.content;
                }
                
                const isSameChat = activeChat && activeChat.id === chatId;
                const targetTopicId = isSameChat && activeTopic ? activeTopic.id : null;

                const res = await fetch('/api/v1/messages/' + chatId, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({
                        content: messageContent,
                        type: messageType,
                        mediaUrl: mediaUrl,
                        forwardFrom: forwardMessageData.senderName,
                        topicId: targetTopicId
                    })
                });
                
                const data = await res.json();
                
                if (data.message) {
                    showToast('success', 'Переслано в ' + chatName, '📨');
                    closeForwardModal();
                    loadChats(); // обновляем список чатов
                }
            } catch (err) {
                console.error('Forward error:', err);
                showToast('error', 'Ошибка пересылки', '❌');
            }
        }

        // Обработчик поиска в модале пересылки
        document.getElementById('forwardSearchInput').addEventListener('input', function(e) {
            renderForwardChatsList(e.target.value.trim());
        });

        // Закрытие модала при клике на оверлей
        document.getElementById('forwardModal').addEventListener('click', function(e) {
            if (e.target.id === 'forwardModal') closeForwardModal();
        });

        function closeConfirmModal() {
            document.getElementById('confirmModal').classList.remove('active');
        }

        // ============================================
        // DELETE CHAT
        // ============================================
        function deleteCurrentChat() {
            if (!activeChat) return;
            
        document.getElementById('confirmTitle').textContent = window.i18n?.t('deleteChatQuestion') || 'Удалить чат?';
            document.getElementById('confirmText').textContent = 'Чат "' + activeChat.name + '" будет удалён.';
            
            document.getElementById('confirmBtn').onclick = async function() {
                try {
                    const res = await fetch('/api/v1/chats/' + activeChat.id, {
                        method: 'DELETE',
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    const data = await res.json();
                    if (res.ok) {
                        closeConfirmModal();
                        closeChat();
                        loadChats();
                        showToast('success', tr('chatDeleted', 'Чат удалён'), '✓');
                    } else {
                        showToast('error', data.error || tr('deleteError', 'Ошибка удаления'), '❌');
                    }
                } catch (err) {
                    showToast('error', tr('networkError', 'Ошибка сети'), '❌');
                }
            };
            
            document.getElementById('confirmModal').classList.add('active');
        }

        // ============================================
        // GROUP MENTIONS (@username, @here, @everyone)
        // ============================================
        async function loadGroupMembersForMentions(chatId) {
            groupMembersForMentions = [];
            currentUserGroupOnline = false;
            if (!chatId) return;
            try {
                const res = await fetch('/api/v1/chats/' + chatId + '/members-online', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) return;
                const data = await res.json();
                const members = data.members || [];
                const me = members.find(m => m.id === user.id);
                currentUserGroupOnline = !!(me && (me.isOnline || me.is_online) && !me.isBot && !me.is_bot);
                if (me && activeChat && activeChat.id === chatId) {
                    activeChat.mutedUntil = me.mutedUntil || null;
                    updateInputAreaMuteState();
                }
                groupMembersForMentions = members
                    .filter(m => m.id !== user.id && !m.isBot && !m.is_bot)
                    .map(m => ({
                        id: m.id,
                        username: m.username || '',
                        firstName: m.firstName || m.first_name || '',
                        lastName: m.lastName || m.last_name || '',
                        avatarUrl: m.avatarUrl || m.avatar_url || '',
                        isOnline: !!(m.isOnline || m.is_online)
                    }));
            } catch (_) {
                groupMembersForMentions = [];
                currentUserGroupOnline = false;
            }
        }

        function hideMentionSuggestions() {
            const el = document.getElementById('mentionSuggestions');
            if (!el) return;
            el.style.display = 'none';
            el.innerHTML = '';
            el.setAttribute('aria-hidden', 'true');
            mentionSuggestionsList = [];
            mentionSuggestionIndex = 0;
        }

        function walkInputTextNodes(node, visitor) {
            if (node.nodeType === Node.TEXT_NODE) {
                visitor('text', node, node.textContent.length);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'IMG' && node.classList.contains('apple-emoji')) {
                    visitor('emoji', node, (node.alt || '').length);
                } else if (node.tagName === 'BR') {
                    visitor('br', node, 1);
                } else {
                    node.childNodes.forEach(function(child) { walkInputTextNodes(child, visitor); });
                }
            }
        }

        function getInputTextRaw() {
            const input = document.getElementById('msgInput');
            if (!input) return '';
            let text = '';
            walkInputTextNodes(input, function(kind, node, len) {
                if (kind === 'text') text += node.textContent;
                else if (kind === 'emoji') text += node.alt || '';
                else if (kind === 'br') text += '\n';
            });
            return text;
        }

        function getCaretCharacterOffset() {
            const input = document.getElementById('msgInput');
            const sel = window.getSelection();
            if (!input || !sel || !sel.rangeCount) return 0;
            const range = sel.getRangeAt(0);
            if (!input.contains(range.endContainer)) return 0;

            let offset = 0;
            let done = false;

            function visit(kind, node, len) {
                if (done) return;
                if (node === range.endContainer) {
                    if (kind === 'text') {
                        offset += Math.min(range.endOffset, len);
                    } else if (node.nodeType === Node.ELEMENT_NODE && range.endOffset === 0) {
                        // caret before this node
                    } else if (kind === 'br' || kind === 'emoji') {
                        offset += len;
                    }
                    done = true;
                    return;
                }
                if (kind === 'text') offset += node.textContent.length;
                else if (kind === 'emoji') offset += (node.alt || '').length;
                else if (kind === 'br') offset += 1;
            }

            input.childNodes.forEach(function(child) {
                if (done) return;
                walkInputTextNodes(child, visit);
            });
            return offset;
        }

        function getMentionContext() {
            const offset = getCaretCharacterOffset();
            const textBefore = getInputTextRaw().slice(0, offset);
            const match = textBefore.match(/@([a-zA-Z0-9_]*)$/);
            if (!match) return null;
            return { query: match[1], fullLen: match[0].length };
        }

        function setRangeAtCharacterOffset(range, chars, collapseToStart) {
            const input = document.getElementById('msgInput');
            if (!input) return false;
            let remaining = chars;
            let placed = false;

            function visit(kind, node, len) {
                if (placed) return;
                if (remaining <= len) {
                    if (kind === 'text') {
                        if (collapseToStart) {
                            range.setStart(node, remaining);
                            range.collapse(true);
                        } else {
                            range.setEnd(node, remaining);
                        }
                    } else if (kind === 'br') {
                        if (collapseToStart) {
                            range.setStartBefore(node);
                            range.collapse(true);
                        } else {
                            range.setEndAfter(node);
                        }
                    } else if (kind === 'emoji') {
                        if (collapseToStart) {
                            range.setStartBefore(node);
                            range.collapse(true);
                        } else {
                            range.setEndAfter(node);
                        }
                    }
                    placed = true;
                    return;
                }
                remaining -= len;
            }

            input.childNodes.forEach(function(child) {
                if (!placed) walkInputTextNodes(child, visit);
            });
            return placed;
        }

        function replaceMentionWithToken(token) {
            const ctx = getMentionContext();
            if (!ctx) return;
            const sel = window.getSelection();
            if (!sel.rangeCount) return;

            const endRange = sel.getRangeAt(0);
            const startPos = getCaretCharacterOffset() - ctx.fullLen;
            const startRange = document.createRange();
            if (!setRangeAtCharacterOffset(startRange, startPos, true)) return;
            startRange.setEnd(endRange.endContainer, endRange.endOffset);

            sel.removeAllRanges();
            sel.addRange(startRange);
            document.execCommand('insertText', false, '@' + token + ' ');
            hideMentionSuggestions();
            document.getElementById('msgInput').focus();
        }

        function buildMentionSuggestions(query) {
            const q = (query || '').toLowerCase();
            const items = [];
            const hereLabel = tr('mentionHere', 'все онлайн');
            const everyoneLabel = tr('mentionEveryone', 'все участники');

            if (!q || 'here'.startsWith(q)) {
                items.push({ type: 'special', token: 'here', name: '@here', subtitle: hereLabel, icon: '🟢' });
            }
            if (!q || 'everyone'.startsWith(q)) {
                items.push({ type: 'special', token: 'everyone', name: '@everyone', subtitle: everyoneLabel, icon: '📢' });
            }

            groupMembersForMentions.forEach(function(m) {
                const username = (m.username || '').toLowerCase();
                const first = (m.firstName || '').toLowerCase();
                const last = (m.lastName || '').toLowerCase();
                const display = (m.firstName + ' ' + (m.lastName || '')).trim().toLowerCase();
                if (!username) return;
                if (q && !username.startsWith(q) && !first.startsWith(q) && !last.startsWith(q) && !display.includes(q)) return;
                items.push({
                    type: 'user',
                    token: m.username,
                    name: m.firstName || m.username,
                    subtitle: '@' + m.username,
                    avatarUrl: m.avatarUrl,
                    initial: (m.firstName || m.username || '?')[0].toUpperCase()
                });
            });

            return items.slice(0, 12);
        }

        function renderMentionSuggestions(items) {
            const el = document.getElementById('mentionSuggestions');
            if (!el) return;
            if (!items.length) {
                hideMentionSuggestions();
                return;
            }
            mentionSuggestionsList = items;
            mentionSuggestionIndex = 0;
            function escMention(s) {
                return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }
            el.innerHTML = items.map(function(item, idx) {
                const active = idx === 0 ? ' active' : '';
                const special = item.type === 'special' ? ' mention-special' : '';
                let avatarHtml = '<span>' + (item.icon || item.initial || '?') + '</span>';
                if (item.avatarUrl) {
                    avatarHtml = '<img src="' + escMention(item.avatarUrl) + '" alt="">';
                }
                return '<div class="mention-suggestion-item' + active + special + '" data-idx="' + idx + '" role="option">'
                    + '<div class="mention-avatar">' + avatarHtml + '</div>'
                    + '<div class="mention-meta"><div class="mention-name">' + escMention(item.name) + '</div>'
                    + '<div class="mention-username">' + escMention(item.subtitle) + '</div></div></div>';
            }).join('');
            el.style.display = 'block';
            el.setAttribute('aria-hidden', 'false');
            el.querySelectorAll('.mention-suggestion-item').forEach(function(row) {
                row.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    const idx = parseInt(row.dataset.idx, 10);
                    const picked = mentionSuggestionsList[idx];
                    if (picked) replaceMentionWithToken(picked.token);
                });
            });
        }

        function highlightMentionSuggestion(idx) {
            const el = document.getElementById('mentionSuggestions');
            if (!el) return;
            el.querySelectorAll('.mention-suggestion-item').forEach(function(row, i) {
                row.classList.toggle('active', i === idx);
            });
        }

        function handleMentionInput() {
            if (!activeChat || activeChat.type !== 'group') {
                hideMentionSuggestions();
                return;
            }
            const ctx = getMentionContext();
            if (!ctx) {
                hideMentionSuggestions();
                return;
            }
            const items = buildMentionSuggestions(ctx.query);
            renderMentionSuggestions(items);
        }

        function selectActiveMentionSuggestion() {
            const picked = mentionSuggestionsList[mentionSuggestionIndex];
            if (picked) replaceMentionWithToken(picked.token);
            return !!picked;
        }

        function notifyIfMentioned(msg, chatId, chatTitle) {
            if (!msg) return;
            const cid = chatId || msg.chatId;
            const fromList = allChats.find(function(c) { return c.id === cid; });
            const chat = fromList || (activeChat && activeChat.id === cid ? activeChat : { type: 'group' });
            if (!doesMessageMentionUser(msg, chat)) return;
            const isActiveMentionChat = !!(activeChat && activeChat.id === cid);
            if (isActiveMentionChat && mentionJumpCursorByChat[cid] === undefined) {
                mentionJumpCursorByChat[cid] = activeChat.mentionReadAt || '';
            }
            if (fromList && !isActiveMentionChat) {
                fromList.mentionCount = (Number(fromList.mentionCount) || 0) + 1;
                fromList.latestMentionAt = msg.createdAt || msg.created_at || new Date().toISOString();
                fromList.oldestMentionMessageId = fromList.oldestMentionMessageId || msg.id || null;
            }
            const chatName = (activeChat && activeChat.id === cid ? activeChat.name : null)
                || chatTitle
                || (fromList && fromList.name)
                || tr('groupChat', 'Группа');
            const sender = msg.senderFirstName || msg.sender?.firstName || msg.senderName || tr('user', 'Пользователь');
            showToast('info', sender + ' ' + tr('mentionedYouIn', 'упомянул вас в') + ' ' + chatName, '@');
            renderChatList();
        }

        // ============================================
        // SEND MESSAGE
        // ============================================
        async function send() {
            const input = document.getElementById('msgInput');
            const text = getInputText();
            if (!text || !activeChat) return;

            const inCommentMode = isCommentThreadActive();
            if (activeChat.type === 'channel' && !inCommentMode) {
                const canPost = activeChat.channelMeta?.canPost === true
                    || activeChat.channelMeta?.role === 'owner'
                    || activeChat.channelMeta?.role === 'admin'
                    || activeChat.role === 'owner'
                    || activeChat.role === 'admin';
                if (!canPost) {
                    showToast('info', tr('channelReadOnly', 'Только администраторы могут публиковать посты'), 'ℹ️');
                    return;
                }
            }
            
            hideMentionSuggestions();
            closeEmojiPicker();
            
            const tempId = 'temp-' + Date.now();
            const tempMsg = {
                id: tempId,
                content: text,
                senderId: user.id,
                time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                senderName: user.firstName || user.username || tr('you', 'Вы'),
                replyToMessageId: replyingTo ? replyingTo.messageId : null,
                parentMessageId: inCommentMode ? commentThreadPostId : null,
                pending: true
            };
            
            messagesData[tempId] = tempMsg;
            const targetMessagesEl = getActiveMessagesEl();
            if (targetMessagesEl) {
                const emptyState = targetMessagesEl.querySelector('.channel-comments-state');
                if (emptyState) emptyState.remove();
                targetMessagesEl.appendChild(createMessageElement(tempMsg));
            }
            scrollToBottom();
            
            input.innerText = '';
            updateSendButton();
            const replyData = replyingTo;
            cancelReply();
            
            try {
                const body = { content: text, type: 'text' };
                if (replyData) body.replyTo = replyData.messageId;
                if (inCommentMode && commentThreadPostId) {
                    body.parentMessageId = commentThreadPostId;
                } else if (activeTopic) {
                    body.topicId = activeTopic.id;
                }
                if (!inCommentMode && activeChat.type === 'channel' && typeof window.getChannelPostExtras === 'function') {
                    Object.assign(body, window.getChannelPostExtras());
                }

                // Если разработчик отвечает на support request через бота
                const isBotChatLocal = activeChat && (activeChat.isBot || (activeChat.name === 'CraneApp'));
                const isChannelFeedPost = activeChat.type === 'channel' && !inCommentMode;
                const activeSupportRaw = localStorage.getItem('craneapp_active_support_request');
                const devUsernames = ['adm1','admin','admin1','qzlfee'];
                const isDevUser = devUsernames.includes((user.username||'').toLowerCase());

                if (isBotChatLocal && isDevUser && activeSupportRaw) {
                    const activeSupport = JSON.parse(activeSupportRaw);
                    if (activeSupport.requestId && activeSupport.requestId !== 'null') {
                        // Отправляем ответ через reply API
                        const replyRes = await fetch('/api/v1/support/requests/' + activeSupport.requestId + '/reply', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                            body: JSON.stringify({ message: text })
                        });
                        if (replyRes.ok) {
                            localStorage.removeItem('craneapp_active_support_request');
                            // Показываем подтверждение в чате с ботом
                            const tempDiv = document.createElement('div');
                            tempDiv.className = 'message outgoing';
                            tempDiv.innerHTML = text + '<div class="msg-time">' + new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + '</div>';
                            document.getElementById('messages').appendChild(tempDiv);
                            document.getElementById('messages').scrollTop = 999999;
                            showToast('success', tr('replySentToUser', 'Ответ отправлен пользователю'), '✓');
                            return;
                        }
                    }
                }
                // E2E шифрование — не шифруем чат с ботом и посты канала
                if (window.E2E && !isBotChatLocal && !isChannelFeedPost) {
                    const enc = await window.E2E.encrypt(text, activeChat.id, token);
                    if (enc.isEncrypted) {
                        body.content = enc.content;
                        body.iv = enc.iv;
                        body.isEncrypted = true;
                        body.contentPlain = text; // Сохраняем оригинальный текст для поиска
                    }
                } else {
                    // Если не шифруем, тоже сохраняем contentPlain
                    body.contentPlain = text;
                }

                const res = await fetch('/api/v1/messages/' + activeChat.id, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify(body)
                });
                const data = await res.json();

                if (res.ok && data.message) {
                    _confirmMessage(tempId, data.message);
                    if (!inCommentMode) loadChats();
                } else if (res.status === 403) {
                    const el = document.querySelector('[data-message-id="' + tempId + '"]');
                    if (el) el.remove();
                    delete messagesData[tempId];
                    if (data.mutedUntil) {
                        if (activeChat) {
                            activeChat.mutedUntil = data.mutedUntil;
                        }
                        updateInputAreaMuteState();
                    }
                    showToast('error', data.error || tr('muted', 'Вы замучены'), '🔇');
                } else {
                    const el = document.querySelector('[data-message-id="' + tempId + '"]');
                    if (el) el.remove();
                    delete messagesData[tempId];
                    showToast('error', data.error || tr('notSent', 'Не отправлено'), '❌');
                }
            } catch (err) {
                const el = document.querySelector('[data-message-id="' + tempId + '"]');
                if (el) el.remove();
                delete messagesData[tempId];
                showToast('error', tr('notSent', 'Не отправлено'), '❌');
            }
        }
        window.send = send;

        // ============================================
        // INPUT TYPING
        // ============================================
        document.getElementById('msgInput').addEventListener('input', function() {
            sendTyping();
            requestAnimationFrame(handleMentionInput);
        });

        // Вставка фото из буфера обмена
        document.getElementById('msgInput').addEventListener('paste', function(e) {
            const items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (!file) return;
                    if (file.size > MAX_FILE_SIZE) {
                        showToast('error', tr('fileTooLarge50', 'Файл слишком большой. Максимум 50 МБ'), '❌');
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = e2 => showMediaSendPreview(e2.target.result, 'image');
                    reader.readAsDataURL(file);
                    return;
                }
            }
        });

        // ============================================
        // TAB BAR
        // ============================================
        const tabs = [
            { icon: '👥', labelKey: 'contacts', page: '../contacts/contacts.html' },
            { icon: '📞', labelKey: 'calls', page: '../calls/calls.html' },
            { icon: '💬', labelKey: 'chats', page: './chats.html', active: true },
            { icon: '⚙', labelKey: 'settings', page: '../settings/settings.html' }
        ];
        
        const tabBar = document.getElementById('tabBar');
        tabs.forEach(function(t) {
            const div = document.createElement('div');
            div.className = 'tab-item' + (t.active ? ' active' : '');
            const label = (window.i18n && window.i18n.t(t.labelKey)) || t.labelKey;
            div.innerHTML = '<span class="tab-icon">' + t.icon + '</span><span class="tab-label" data-i18n="' + t.labelKey + '">' + label + '</span>';
            div.onclick = function() { if (!t.active) location.href = t.page; };
            tabBar.appendChild(div);
        });

        // ============================================
        // TOAST
        // ============================================
        function showToast(type, message, icon) {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = 'toast ' + type;
            if (window.i18n && typeof message === 'string') {
                message = window.i18n.localizeText(message);
            }
            toast.innerHTML = '<span>' + icon + '</span><span>' + message + '</span>';
            container.appendChild(toast);
            setTimeout(function() {
                toast.style.opacity = '0';
                setTimeout(function() { toast.remove(); }, 300);
            }, 3000);
        }

        // ============================================
        // PIN & ARCHIVE CHATS
        // ============================================

        // Pin чат
        async function pinChat(chatId) {
            try {
                const res = await fetch('/api/v1/chats/' + chatId + '/pin', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: '{}'
                });
                const data = await res.json();
                if (res.ok) {
                    pinnedChatIds.add(chatId);
                    showToast('success', tr('chatPinned', 'Чат закреплён'), '📌');
                    loadChats();
                } else {
                    showToast('error', data.error || tr('error', 'Ошибка'), '❌');
                }
            } catch (err) {
                showToast('error', tr('networkError', 'Ошибка сети'), '❌');
            }
        }

        async function unpinChat(chatId) {
            try {
                const res = await fetch('/api/v1/chats/' + chatId + '/pin', {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: '{}'
                });
                const data = await res.json();
                if (res.ok) {
                    pinnedChatIds.delete(chatId);
                    showToast('success', tr('chatUnpinned', 'Чат откреплён'), '📌');
                    loadChats();
                } else {
                    showToast('error', data.error || tr('error', 'Ошибка'), '❌');
                }
            } catch (err) {
                showToast('error', tr('networkError', 'Ошибка сети'), '❌');
            }
        }

        async function archiveChat(chatId) {
            try {
                const res = await fetch('/api/v1/chats/' + chatId + '/archive', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: '{}'
                });
                const data = await res.json();
                if (res.ok) {
                    showToast('success', tr('chatArchived', 'Чат архивирован'), '📁');
                    loadChats();
                } else {
                    showToast('error', data.error || tr('error', 'Ошибка'), '❌');
                }
            } catch (err) {
                showToast('error', tr('networkError', 'Ошибка сети'), '❌');
            }
        }

        async function unarchiveChat(chatId) {
            try {
                const res = await fetch('/api/v1/chats/' + chatId + '/archive', {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: '{}'
                });
                const data = await res.json();
                if (res.ok) {
                    showToast('success', tr('chatRestored', 'Чат восстановлен'), '📁');
                    loadChats();
                } else {
                    showToast('error', data.error || tr('error', 'Ошибка'), '❌');
                }
            } catch (err) {
                showToast('error', tr('networkError', 'Ошибка сети'), '❌');
            }
        }

        // Загрузить архивированные чаты
        async function loadArchivedChats() {
            try {
                const res = await fetch('/api/v1/chats/archived', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                
                archivedChats = [];
                const seenArchivedIds = new Set(); // Защита от дубликатов
                
                if (data.chats && data.chats.length > 0) {
                    // Сначала собираем все ID приватных чатов (только уникальные)
                    const privateChatIds = [];
                    const seenChatIds = new Set();
                    
                    for (const c of data.chats) {
                        if (!seenChatIds.has(c.id)) {
                            seenChatIds.add(c.id);
                            if (c.type === 'private') {
                                privateChatIds.push(c.id);
                            }
                        }
                    }
                    
                    // Параллельно загружаем участников для всех приватных чатов
                    const memberPromises = privateChatIds.map(async (chatId) => {
                        try {
                            const mRes = await fetch('/api/v1/chats/' + chatId + '/members', {
                                headers: { 'Authorization': 'Bearer ' + token }
                            });
                            const mData = await mRes.json();
                            const other = mData.members && mData.members.find(m => m.id !== user.id);
                            
                            if (other) {
                                chatUsers[chatId] = {
                                    id: other.id,
                                    username: other.username,
                                    name: other.first_name || other.username,
                                    av: other.avatar_url,
                                    bio: other.bio || '',
                                    isOnline: other.is_online
                                };
                                return { chatId, name: other.first_name || other.username, avatar: other.avatar_url };
                            }
                        } catch (e) {
                            console.error('Error loading archived chat members:', e);
                        }
                        return null;
                    });
                    
                    const memberData = await Promise.all(memberPromises);
                    const memberMap = {};
                    memberData.forEach(m => {
                        if (m) memberMap[m.chatId] = m;
                    });
                    
                    // Теперь формируем массив архивированных чатов (с защитой от дубликатов)
                    for (const c of data.chats) {
                        // Пропускаем дубликаты по ID
                        if (seenArchivedIds.has(c.id)) {
                            continue;
                        }
                        seenArchivedIds.add(c.id);
                        
                        let chatName = c.title || 'Чат';
                        let chatAv = '💬';
                        
                        if (c.type === 'private' && memberMap[c.id]) {
                            chatName = memberMap[c.id].name;
                            chatAv = memberMap[c.id].avatar || (chatName[0] || '?');
                        }
                        
                        let lastMsgText = formatLastMessage(c);
                        
                        archivedChats.push(prepareChatEntry(c, {
                            id: c.id,
                            type: c.type,
                            name: chatName,
                            title: chatName,
                            av: chatAv,
                            avatarUrl: chatAv,
                            lastMessage: lastMsgText,
                            unreadCount: c.unreadCount || 0,
                            role: c.role,
                            mutedUntil: c.mutedUntil || null,
                            time: c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''
                        }));
                    }
                }
                
                console.log('✅ Archived chats loaded:', archivedChats.length);
            } catch (err) {
                console.error('Load archived chats error:', err);
                archivedChats = [];
            }
        }

        function toggleArchivedChats() {
            const list = document.getElementById('archivedChatsList');
            if (list) {
                list.style.display = list.style.display === 'none' ? 'block' : 'none';
            }
        }

        function openArchivedChat(id, name) {
            // Находим чат в архивированных для получения правильного имени
            const chat = archivedChats.find(function(c) { return c.id === id; });
            const chatName = chat ? (chat.name || chat.title) : name;
            // Просто открываем чат - НЕ разархивируем его
            openChat(id, chatName);
        }

        // Context Menu для чата
        function showChatContextMenu(e, chatId) {
            e.preventDefault();
            currentContextChatId = chatId;
            
            const menu = document.getElementById('chatContextMenu');
            const x = e.pageX || e.clientX || 0;
            const y = e.pageY || e.clientY || 0;
            
            menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
            menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
            menu.classList.add('active');
            
            // Проверяем статус pinned
            const isPinned = pinnedChatIds.has(chatId);
            const isArchived = archivedChats.some(c => c.id === chatId);
            
            // Обновляем текст пункта "Закрепить/Открепить"
            const pinText = document.getElementById('contextPinText');
            if (pinText) {
                const pinKey = isPinned ? 'unpin' : 'pin';
                pinText.setAttribute('data-i18n', pinKey);
                pinText.textContent = tr(pinKey, isPinned ? 'Unpin' : 'Pin');
            }
            
            // Обновляем текст пункта "Архивировать/Разархивировать"
            const archiveText = document.getElementById('contextArchiveText');
            const archiveItem = document.getElementById('contextArchiveItem');
            if (isArchived) {
                if (archiveText) {
                    archiveText.setAttribute('data-i18n', 'unarchiveChat');
                    archiveText.textContent = tr('unarchiveChat', 'Unarchive');
                }
                if (archiveItem) archiveItem.onclick = function() { unarchiveChatFromMenu(); };
            } else {
                if (archiveText) {
                    archiveText.setAttribute('data-i18n', 'archiveChat');
                    archiveText.textContent = tr('archiveChat', 'Archive');
                }
                if (archiveItem) archiveItem.onclick = function() { archiveChatFromMenu(); };
            }
        }

        function pinChatFromMenu() {
            document.getElementById('chatContextMenu').classList.remove('active');
            const isPinned = pinnedChatIds.has(currentContextChatId);
            if (isPinned) {
                unpinChat(currentContextChatId);
            } else {
                pinChat(currentContextChatId);
            }
        }

        function archiveChatFromMenu() {
            document.getElementById('chatContextMenu').classList.remove('active');
            archiveChat(currentContextChatId);
        }

        function unarchiveChatFromMenu() {
            document.getElementById('chatContextMenu').classList.remove('active');
            unarchiveChat(currentContextChatId);
        }

        async function addContextChatToFolder() {
            const chatId = currentContextChatId;
            document.getElementById('chatContextMenu').classList.remove('active');
            if (!chatId) return;
            folderSelectChatId = chatId;
            await openFolderSelectModal();
        }

        async function markChatReadFromMenu() {
            const chatId = currentContextChatId;
            document.getElementById('chatContextMenu').classList.remove('active');
            if (!chatId) return;

            try {
                await markChatAsRead(chatId, { acknowledgeMentions: true });
            } catch (err) {
                showToast('error', tr('saveError', 'Ошибка сохранения'), '❌');
            }
        }

        function deleteChatFromMenu() {
            document.getElementById('chatContextMenu').classList.remove('active');
            const chat = allChats.find(c => c.id === currentContextChatId);
            activeChat = { id: currentContextChatId, name: chat?.name || chat?.title || 'Чат' };
            deleteCurrentChat();
        }

        // Закрыть контекстное меню при клике
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.chat-context-menu')) {
                document.getElementById('chatContextMenu').classList.remove('active');
            }
        });

        // ============================================
        // VIDEO NOTES (кружки)
        // ============================================
        let videoNoteRecorder = null;
        let videoNoteChunks = [];
        let videoNoteTimer = null;
        let videoNoteSeconds = 0;
        let videoNoteStream = null;
        let videoNoteRecording = false;
        const VIDEO_NOTE_MAX = 60; // 1 минута

        // Обновляем переключение кнопок при вводе текста
        function getInputText() {
            const raw = getInputTextRaw().trim();
            if (raw) return raw;
            const input = document.getElementById('msgInput');
            if (!input) return '';
            return (input.innerText || input.textContent || '').replace(/\u00a0/g, ' ').trim();
        }

        function updateSendButton() {
            const sendBtn = document.getElementById('sendBtn');
            if (!sendBtn) return;
            const hasText = getInputText().length > 0;
            const inCommentMode = isCommentThreadActive();
            const canComposeChannelPost = activeChat
                && activeChat.type === 'channel'
                && !inCommentMode
                && (activeChat.channelMeta?.canPost === true
                    || activeChat.channelMeta?.role === 'owner'
                    || activeChat.channelMeta?.role === 'admin'
                    || activeChat.role === 'owner'
                    || activeChat.role === 'admin');
            const canCompose = !activeChat
                || activeChat.type !== 'channel'
                || inCommentMode
                || canComposeChannelPost;
            sendBtn.style.display = (hasText && canCompose) ? 'flex' : 'none';
        }
        const _origInputHandler = document.getElementById('msgInput').oninput;
        document.getElementById('msgInput').addEventListener('input', updateSendButton);
        window._updateSendButton = updateSendButton;
        const sendBtnEl = document.getElementById('sendBtn');
        if (sendBtnEl) {
            sendBtnEl.addEventListener('click', function(e) {
                e.preventDefault();
                send();
            });
        }

        
        async function startVideoNoteHold(e) {
            if (videoNoteRecording) return;
            if (!activeChat) { showToast('info', 'Выберите чат', '⚠️'); return; }

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                showToast('error', 'Браузер не поддерживает запись', '📹'); return;
            }

            try {
                // Пробуем с фронтальной камерой, при ошибке — любую
                try {
                    videoNoteStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
                        audio: true
                    });
                } catch (_) {
                    videoNoteStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                }

                // Показываем предпросмотр
                const preview = document.getElementById('videoNotePreview');
                preview.srcObject = videoNoteStream;
                document.getElementById('videoNoteOverlay').classList.add('active');

                videoNoteChunks = [];
                videoNoteSeconds = 0;
                videoNoteRecording = true;

                const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
                    ? 'video/webm;codecs=vp9,opus'
                    : MediaRecorder.isTypeSupported('video/webm')
                    ? 'video/webm' : 'video/mp4';

                videoNoteRecorder = new MediaRecorder(videoNoteStream, { mimeType });
                videoNoteRecorder.ondataavailable = e => { if (e.data.size > 0) videoNoteChunks.push(e.data); };
                videoNoteRecorder.onstop = () => {
                    videoNoteStream.getTracks().forEach(t => t.stop());
                    if (videoNoteChunks.length > 0 && !videoNoteCancelled) {
                        const blob = new Blob(videoNoteChunks, { type: mimeType });
                        sendVideoNote(blob, videoNoteSeconds);
                    }
                    resetVideoNoteUI();
                };
                videoNoteRecorder.start(100);

                // Прогресс-бар и таймер
                const circumference = 2 * Math.PI * 54;
                const bar = document.getElementById('videoNoteProgressBar');
                bar.style.strokeDasharray = circumference;
                bar.style.strokeDashoffset = circumference;

                videoNoteTimer = setInterval(() => {
                    videoNoteSeconds++;
                    const m = Math.floor(videoNoteSeconds / 60);
                    const s = videoNoteSeconds % 60;
                    document.getElementById('videoNoteTimer').textContent = m + ':' + String(s).padStart(2, '0');
                    // Прогресс
                    const progress = videoNoteSeconds / VIDEO_NOTE_MAX;
                    bar.style.strokeDashoffset = circumference * (1 - progress);
                    if (videoNoteSeconds >= VIDEO_NOTE_MAX) stopVideoNoteHold();
                }, 1000);

            } catch (err) {
                console.error('Video note error:', err.name, err.message);
                // Освобождаем стрим если он был частично захвачен
                if (videoNoteStream) {
                    videoNoteStream.getTracks().forEach(t => t.stop());
                    videoNoteStream = null;
                }
                videoNoteRecording = false;
                document.getElementById('videoNoteOverlay').classList.remove('active');

                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    showToast('error', 'Нет доступа к камере — нажмите на 🔒 в адресной строке и разрешите камеру', '📹');
                } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                    showToast('error', 'Камера не найдена', '📹');
                    cameraAvailable = false;
                } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                    showToast('error', 'Камера занята другим приложением', '📹');
                } else if (err.name === 'OverconstrainedError') {
                    showToast('error', 'Камера не поддерживает нужный формат', '📹');
                    cameraAvailable = false;
                } else if (err.name === 'SecurityError') {
                    showToast('error', 'Доступ к камере заблокирован (нужен HTTPS)', '📹');
                } else {
                    showToast('error', 'Ошибка камеры: ' + (err.message || err.name), '📹');
                }
            }
        }

        let videoNoteCancelled = false;

        function stopVideoNoteHold(e) {
            if (!videoNoteRecording) return;
            videoNoteCancelled = false;
            clearInterval(videoNoteTimer);
            videoNoteTimer = null;
            videoNoteRecording = false;
            if (videoNoteRecorder && videoNoteRecorder.state !== 'inactive') {
                videoNoteRecorder.stop();
            }
        }

        function stopVideoNoteHoldIfRecording() {
            if (videoNoteRecording) stopVideoNoteHold();
        }

        function cancelVideoNote() {
            videoNoteCancelled = true;
            videoNoteChunks = [];
            clearInterval(videoNoteTimer);
            videoNoteTimer = null;
            videoNoteRecording = false;
            if (videoNoteRecorder && videoNoteRecorder.state !== 'inactive') {
                videoNoteRecorder.stop();
            }
            if (videoNoteStream) videoNoteStream.getTracks().forEach(t => t.stop());
            resetVideoNoteUI();
        }

        function resetVideoNoteUI() {
            document.getElementById('videoNoteOverlay').classList.remove('active');
            const preview = document.getElementById('videoNotePreview');
            preview.srcObject = null;
            videoNoteSeconds = 0;
            videoNoteRecording = false;
            videoNoteCancelled = false;
            videoNoteStream = null;
            videoNoteRecorder = null;
            videoNoteChunks = [];
            clearInterval(videoNoteTimer);
            videoNoteTimer = null;
        }

        async function sendVideoNote(blob, duration) {
            if (!activeChat) return;
            const tempId = 'temp-' + Date.now();
            const localUrl = URL.createObjectURL(blob);
            const msg = {
                id: tempId, senderId: user.id, type: 'video_note',
                mediaUrl: localUrl, voiceDuration: duration,
                time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                senderName: user.firstName || 'Вы',
                parentMessageId: isCommentThreadActive() ? commentThreadPostId : null,
                pending: true
            };
            messagesData[tempId] = msg;
            appendMessageToActiveList(msg);

            const reader = new FileReader();
            reader.onload = async function(e) {
                const base64 = e.target.result;
                try {
                    const uploadRes = await fetch('/api/v1/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ file: base64, type: 'video_note' })
                    });
                    const uploadData = await uploadRes.json();
                    const serverUrl = uploadData.url;
                    if (!serverUrl) { showToast('error', tr('loadingError', 'Ошибка загрузки'), '❌'); return; }
                    URL.revokeObjectURL(localUrl);
                    const videoNoteBody = {
                        content: '',
                        type: 'video_note',
                        mediaUrl: serverUrl,
                        mediaType: 'video_note',
                        voiceDuration: duration,
                        topicId: activeTopic ? activeTopic.id : null
                    };
                    if (isCommentThreadActive() && commentThreadPostId) {
                        videoNoteBody.parentMessageId = commentThreadPostId;
                        delete videoNoteBody.topicId;
                    }
                    const res = await fetch('/api/v1/messages/' + activeChat.id, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify(videoNoteBody)
                    });
                    const data = await res.json();
                    if (data.message) { _confirmMessage(tempId, data.message); }
                } catch (err) { showToast('error', tr('sendError', 'Ошибка отправки'), '❌'); }
            };
            reader.readAsDataURL(blob);
        }

        // Создание элемента видеокружка
        function createVideoNoteElement(mediaUrl, duration) {
            const wrapper = document.createElement('div');
            wrapper.className = 'video-note-msg';

            const circle = document.createElement('div');
            circle.className = 'video-note-msg-circle';

            const video = document.createElement('video');
            video.src = mediaUrl;
            video.loop = false;
            video.muted = false;
            video.playsInline = true;
            video.preload = 'metadata';

            // SVG прогресс
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 120 120');
            svg.classList.add('video-note-msg-progress');
            const circumference = 2 * Math.PI * 54;
            const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            bgCircle.setAttribute('cx', '60'); bgCircle.setAttribute('cy', '60'); bgCircle.setAttribute('r', '54');
            bgCircle.classList.add('video-note-progress-bg');
            const barCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            barCircle.setAttribute('cx', '60'); barCircle.setAttribute('cy', '60'); barCircle.setAttribute('r', '54');
            barCircle.classList.add('video-note-progress-bar');
            barCircle.style.strokeDasharray = circumference;
            barCircle.style.strokeDashoffset = circumference;
            svg.appendChild(bgCircle); svg.appendChild(barCircle);

            // Кнопка play
            const playBtn = document.createElement('div');
            playBtn.className = 'video-note-msg-play';
            playBtn.innerHTML = '▶';

            let playing = false;
            let progressInterval = null;

            circle.onclick = function() {
                if (playing) {
                    video.pause();
                    playing = false;
                    playBtn.style.display = 'flex';
                    clearInterval(progressInterval);
                } else {
                    // Останавливаем другие видео
                    document.querySelectorAll('.video-note-msg video').forEach(v => { if (v !== video) v.pause(); });
                    video.play().then(() => {
                        playing = true;
                        playBtn.style.display = 'none';
                        progressInterval = setInterval(() => {
                            if (!video.duration) return;
                            const p = video.currentTime / video.duration;
                            barCircle.style.strokeDashoffset = circumference * (1 - p);
                        }, 100);
                    }).catch(() => {});
                }
            };

            video.addEventListener('ended', () => {
                playing = false;
                playBtn.style.display = 'flex';
                clearInterval(progressInterval);
                barCircle.style.strokeDashoffset = circumference;
                video.currentTime = 0;
            });

            circle.appendChild(video);
            circle.appendChild(svg);
            circle.appendChild(playBtn);
            wrapper.appendChild(circle);

            // Длительность
            if (duration > 0) {
                const dur = document.createElement('div');
                dur.className = 'video-note-msg-dur';
                const m = Math.floor(duration / 60), s = duration % 60;
                dur.textContent = m + ':' + String(s).padStart(2, '0');
                wrapper.appendChild(dur);
            }

            return wrapper;
        }
         try {
             connectWebSocket();
         } catch (e) {
             console.error('Error connecting websocket:', e);
         }
         // Инициализируем браузерные уведомления
         try {
             initNotifications();
         } catch (e) {
             console.error('Error initializing notifications:', e);
         }
         try {
             loadChats().then(function() {
                 initFolderTabs();
                 // Открываем чат из параметра URL (например из папки)
                 const params = new URLSearchParams(window.location.search);
                 const openChatId = params.get('openChat') || params.get('chat') || params.get('id');
                 if (openChatId) {
                     const chat = allChats.find(function(c) { return c.id === openChatId; });
                     if (chat) {
                         openChat(chat.id, chat.name || chat.title);
                     }
                     // Убираем параметр из URL
                     history.replaceState({}, '', window.location.pathname);
                 }
             }).catch(function(e) {
                 console.error('Error in loadChats promise chain:', e);
             });
         } catch (e) {
             console.error('Error loading chats:', e);
         }
         syncUserData();
         updateSideMenuProfile();
         try {
             if (window.applyTheme) window.applyTheme();
         } catch (e) { console.error(e); }
         try {
             if (window.initEmojis) window.initEmojis();
         } catch (e) { console.error(e); }
         try {
             loadGifs();
         } catch (e) { console.error(e); }
         try {
             loadStickerPacks();
         } catch (e) { console.error(e); }
         // Применяем переводы
         setTimeout(function() { if (window.i18n) window.i18n.translatePage(); }, 200);
 window.addEventListener('craneapp:languagechange', function() {
     if (window.i18n) {
         ['activeCallBar', 'inputLeftBtns', 'attachmentPanel', 'emojiPicker'].forEach(function(id) {
             const el = document.getElementById(id);
             if (el) window.i18n.translatePage(el);
         });
     }
     renderChatList();
     if (activeChat) loadMessages();
     if (activeChat && chatUsers[activeChat.id]) {
         const statusEl = document.getElementById('chatStatus');
         const chatUser = chatUsers[activeChat.id];
         if (statusEl) {
             if (chatUser.isBlocked) {
                 statusEl.textContent = tr('accountBlocked', 'Account blocked');
                 statusEl.style.color = '#FF4B4B';
             } else {
                 statusEl.textContent = chatStatusText(chatUser);
                 statusEl.style.color = (chatUser.isOnline || chatUser.online) ? 'var(--success-color)' : 'var(--text-muted)';
             }
         }
     }
     if (currentContextChatId && document.getElementById('chatContextMenu')?.classList.contains('active')) {
         const isPinned = pinnedChatIds.has(currentContextChatId);
         const isArchived = archivedChats.some(c => c.id === currentContextChatId);
         const pinText = document.getElementById('contextPinText');
         const archiveText = document.getElementById('contextArchiveText');
         if (pinText) {
             const pinKey = isPinned ? 'unpin' : 'pin';
             pinText.setAttribute('data-i18n', pinKey);
             pinText.textContent = tr(pinKey, isPinned ? 'Unpin' : 'Pin');
         }
         if (archiveText) {
             const archiveKey = isArchived ? 'unarchiveChat' : 'archiveChat';
             archiveText.setAttribute('data-i18n', archiveKey);
             archiveText.textContent = tr(archiveKey, isArchived ? 'Unarchive' : 'Archive');
         }
     }
     _renderActiveCallBar();
 });

        // ============================================
        // CREATE GROUP
        // ============================================
        let groupSelectedIds = new Set();
        let groupAvatarBase64 = null;
        let groupSearchTimeout = null;

        function openCreateGroupModal() {
            groupSelectedIds = new Set();
            groupAvatarBase64 = null;
            document.getElementById('groupTitleInput').value = '';
            document.getElementById('groupDescInput').value = '';
            document.getElementById('groupMemberSearch').value = '';
            document.getElementById('groupSelectedMembers').innerHTML = '';
            document.getElementById('groupMemberList').innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Начните вводить имя или @username</div>';
            document.getElementById('groupAvatarPreview').innerHTML = '👥';
            document.getElementById('createGroupModal').classList.add('active');
        }

        function closeCreateGroupModal() {
            document.getElementById('createGroupModal').classList.remove('active');
        }

        // ── Support Requests ──────────────────────────────────────────────
        let supportPanelOpen = false;

        async function openSupportRequests() {
            supportPanelOpen = !supportPanelOpen;
            const panel = document.getElementById('supportPanel');
            const msgs = document.getElementById('messages');
            if (supportPanelOpen) {
                panel.style.display = 'block';
                msgs.style.display = 'none';
                await loadSupportRequests();
            } else {
                panel.style.display = 'none';
                msgs.style.display = 'flex';
            }
        }

        // ── Reports Panel ──────────────────────────────────────────────────
        let reportsPanelOpen = false;

        async function openReportsPanel() {
            reportsPanelOpen = !reportsPanelOpen;
            const panel = document.getElementById('reportsPanel');
            const msgs = document.getElementById('messages');
            if (reportsPanelOpen) {
                panel.style.display = 'block';
                msgs.style.display = 'none';
                await loadReports();
            } else {
                panel.style.display = 'none';
                msgs.style.display = 'flex';
            }
        }

        async function loadReports() {
            const list = document.getElementById('reportsList');
            list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">Загрузка...</div>';
            try {
                const r = await fetch('/api/v1/reports', { headers: { Authorization: 'Bearer ' + token } });
                if (!r.ok) { list.innerHTML = '<div style="color:#FF4B4B;padding:12px">Ошибка загрузки</div>'; return; }
                const d = await r.json();
                const reports = d.reports || [];
                if (!reports.length) {
                    list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px">Нет жалоб</div>';
                    return;
                }
                list.innerHTML = reports.map(rep => {
                    const statusColors = {
                        pending: '#FFA500',
                        resolved: '#00FF88',
                        rejected: '#FF4B4B'
                    };
                    const statusLabels = {
                        pending: 'На рассмотрении',
                        resolved: 'Решено',
                        rejected: 'Отклонено'
                    };
                    return `
                        <div class="report-item" onclick="openReportDetails('${rep.id}')" style="background:var(--bg-tertiary);border-radius:12px;padding:12px;margin-bottom:8px;cursor:pointer;transition:background 0.2s;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                                <span style="font-weight:600;font-size:14px;">${rep.reported_username || 'Пользователь'}</span>
                                <span style="font-size:12px;padding:4px 8px;border-radius:8px;background:${statusColors[rep.status] || '#888'}20;color:${statusColors[rep.status] || '#888'};">${statusLabels[rep.status] || rep.status}</span>
                            </div>
                            <div style="font-size:13px;color:var(--text-muted);margin-bottom:4px;">${getReasonLabel(rep.reason)}</div>
                            <div style="font-size:12px;color:var(--text-secondary);">${new Date(rep.created_at).toLocaleString('ru-RU')}</div>
                        </div>
                    `;
                }).join('');
            } catch (err) {
                list.innerHTML = '<div style="color:#FF4B4B;padding:12px">Ошибка сети</div>';
            }
        }

        function getReasonLabel(reason) {
            const labels = {
                spam: '📢 Спам',
                harassment: '⚠️ Оскорбления',
                violence: '🔫 Угрозы насилием',
                scam: '💰 Мошенничество',
                fake: '🎭 Фейковый аккаунт',
                other: '📝 Другое'
            };
            return labels[reason] || reason;
        }

        async function forgiveUser() {
            if (!currentProfileUser) return;
            try {
                const res = await fetch('/api/v1/users/' + currentProfileUser.id + '/forgive', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                    showToast('success', 'Пользователь прощён', '✓');
                    closeUserProfileModal();
                    loadReports();
                } else {
                    showToast('error', 'Ошибка', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        async function muteUser() {
            if (!currentProfileUser) return;
            try {
                const res = await fetch('/api/v1/users/' + currentProfileUser.id + '/mute', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                    showToast('success', 'Пользователь замучен', '🔇');
                } else {
                    showToast('error', 'Ошибка', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        let currentDurationAction = null;

        function openDurationModal(action) {
            currentDurationAction = action;
            const modal = document.getElementById('durationModal');
            const title = document.getElementById('durationModalTitle');
            title.textContent = action === 'mute' ? (window.i18n?.t('muteDurationTitle') || '🔇 Выберите время мута') : (window.i18n?.t('banDurationTitle') || '🚫 Выберите время бана');
            modal.classList.add('active');
        }

        function closeDurationModal() {
            document.getElementById('durationModal').classList.remove('active');
            currentDurationAction = null;
        }

        async function applyDuration(duration) {
            if (!currentProfileUser || !currentDurationAction || !currentProfileUser.id) {
                console.error('Invalid state:', { currentProfileUser, currentDurationAction });
                return;
            }
            const action = currentDurationAction;
            const reason = document.getElementById('durationReason').value.trim();
            closeDurationModal();

            try {
                const url = '/api/v1/users/' + currentProfileUser.id + '/' + action;
                console.log('Calling:', url, { duration, reason });
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ duration, reason })
                });
                if (res.ok) {
            showToast('success', action === 'mute' ? (window.i18n?.t('userMuted') || 'Пользователь замучен') : (window.i18n?.t('userBlocked') || 'Пользователь заблокирован'), action === 'mute' ? '🔇' : '🚫');
                    closeUserProfileModal();
                    // Обновляем список жалоб
                    loadReports();
                } else {
                    const error = await res.json();
                    console.error('API error:', error);
                    showToast('error', 'Ошибка: ' + (error.error || 'Неизвестная ошибка'), '❌');
                }
            } catch (err) {
                console.error('Network error:', err);
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        function muteUser() {
            openDurationModal('mute');
        }

        function blockUser() {
            openDurationModal('block');
        }

        function closeMuteInfoModal() {
            document.getElementById('muteInfoModal').classList.remove('active');
        }

        async function checkMuteStatus() {
            try {
                const res = await fetch('/api/v1/users/' + user.id + '/profile', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const data = await res.json();
                    const userData = data.user;
                    globalMuted = !!userData.isMuted;
                    globalMutedUntil = userData.mutedUntil || null;
                    updateInputAreaMuteState();
                }
            } catch (err) {
                console.error('Check mute status error:', err);
            }
        }

        function updateInputAreaMuteState() {
            if (muteCountdownInterval) {
                clearInterval(muteCountdownInterval);
                muteCountdownInterval = null;
            }

            const mutePanel = document.getElementById('mutePanel');
            const inputLeftBtns = document.getElementById('inputLeftBtns');
            const msgInput = document.getElementById('msgInput');
            const sendBtn = document.getElementById('sendBtn');
            const videoNoteBtn = document.getElementById('videoNoteBtn');
            const mutePanelText = document.getElementById('mutePanelText');
            const mutePanelTitle = mutePanel ? mutePanel.querySelector('div > div > div:first-child') : null;

            const isGlobalMuted = globalMuted && (!globalMutedUntil || new Date(globalMutedUntil) > new Date());
            const isGroupMuted = activeChat && activeChat.type === 'group' && activeChat.mutedUntil && new Date(activeChat.mutedUntil) > new Date();

            if (isGlobalMuted || isGroupMuted) {
                if (mutePanel) mutePanel.style.display = 'block';
                if (inputLeftBtns) inputLeftBtns.style.display = 'none';
                if (msgInput) msgInput.style.display = 'none';
                if (sendBtn) sendBtn.style.display = 'none';
                if (videoNoteBtn) videoNoteBtn.style.display = 'none';

                const targetUntil = isGlobalMuted ? globalMutedUntil : activeChat.mutedUntil;

                if (mutePanelTitle) {
                    mutePanelTitle.textContent = isGlobalMuted ? 'Вы замучены' : 'Вы заглушены в этой группе';
                }

                if (targetUntil) {
                    const untilDate = new Date(targetUntil);

                    function tick() {
                        const now = new Date();
                        const diffMs = untilDate - now;

                        if (diffMs <= 0) {
                            if (muteCountdownInterval) {
                                clearInterval(muteCountdownInterval);
                                muteCountdownInterval = null;
                            }
                            if (isGlobalMuted) {
                                globalMuted = false;
                                globalMutedUntil = null;
                            }
                            if (isGroupMuted) {
                                activeChat.mutedUntil = null;
                            }
                            updateInputAreaMuteState();
                            return;
                        }

                        const diffSecs = Math.floor(diffMs / 1000) % 60;
                        const diffMins = Math.floor(diffMs / (1000 * 60)) % 60;
                        const diffHours = Math.floor(diffMs / (1000 * 60 * 60)) % 24;
                        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                        let timeText = '';
                        if (diffDays > 0) {
                            timeText = `Осталось ${diffDays} д. ${diffHours} ч. ${diffMins} мин.`;
                        } else if (diffHours > 0) {
                            timeText = `Осталось ${diffHours} ч. ${diffMins} мин. ${diffSecs} сек.`;
                        } else if (diffMins > 0) {
                            timeText = `Осталось ${diffMins} мин. ${diffSecs} сек.`;
                        } else {
                            timeText = `Осталось ${diffSecs} сек.`;
                        }

                        const dateStr = untilDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + untilDate.toLocaleDateString([], { day: 'numeric', month: 'short' });
                        if (mutePanelText) {
                            mutePanelText.textContent = `До ${dateStr} (${timeText})`;
                        }
                    }

                    tick();
                    muteCountdownInterval = setInterval(tick, 1000);
                } else {
                    if (mutePanelText) {
                        mutePanelText.textContent = 'Навсегда';
                    }
                }
            } else {
                if (mutePanel) mutePanel.style.display = 'none';
                if (inputLeftBtns) inputLeftBtns.style.display = 'flex';
                if (msgInput) msgInput.style.display = 'block';
                updateSendButton();
                if (videoNoteBtn) {
                    videoNoteBtn.style.display = (activeChat && activeChat.type === 'channel') ? 'none' : 'block';
                }
            }
        }

        async function showMuteInfoModal(errorMessage) {
            const modal = document.getElementById('muteInfoModal');
            const infoText = document.getElementById('muteInfoText');
            const reasonBlock = document.getElementById('muteReasonBlock');
            const reasonText = document.getElementById('muteReasonText');

            // Парсим причину из сообщения об ошибке
            let reason = null;
            if (errorMessage && errorMessage.includes('Причина:')) {
                reason = errorMessage.split('Причина: ')[1];
            }

            // Получаем данные пользователя для информации о дате окончания мута
            try {
                const res = await fetch('/api/v1/users/' + user.id + '/profile', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const data = await res.json();
                    const userData = data.user;

                    if (userData.mutedUntil) {
                        const mutedUntil = new Date(userData.mutedUntil);
                        const now = new Date();
                        const diffMs = mutedUntil - now;
                        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                        const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

                        let timeText = '';
                        if (diffDays > 0) {
                            timeText = `Осталось ${diffDays} ${diffDays === 1 ? 'день' : diffDays < 5 ? 'дня' : 'дней'}`;
                        } else if (diffHours > 0) {
                            timeText = `Осталось ${diffHours} ${diffHours === 1 ? 'час' : diffHours < 5 ? 'часа' : 'часов'}`;
                        } else {
                            timeText = 'Мут скоро истечет';
                        }

                        const dateStr = mutedUntil.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
                        infoText.textContent = `До ${dateStr} (${timeText})`;
                    } else {
                        infoText.textContent = 'Навсегда';
                    }
                } else {
                    infoText.textContent = 'Загрузка...';
                }
            } catch (err) {
                infoText.textContent = 'Ошибка загрузки данных';
            }

            // Показываем причину если есть
            if (reason) {
                reasonBlock.style.display = 'block';
                reasonText.textContent = reason;
            } else {
                reasonBlock.style.display = 'none';
            }

            modal.classList.add('active');
        }

        async function unmuteUser() {
            if (!currentProfileUser) return;
            try {
                const res = await fetch('/api/v1/users/' + currentProfileUser.id + '/unmute', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                    showToast('success', 'Пользователь размучен', '🔊');
                    closeUserProfileModal();
                    loadReports();
                } else {
                    showToast('error', 'Ошибка', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        async function unblockUser() {
            if (!currentProfileUser) return;
            try {
                const res = await fetch('/api/v1/users/' + currentProfileUser.id + '/unblock', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                    showToast('success', 'Пользователь разбанен', '✅');
                    closeUserProfileModal();
                    loadReports();
                } else {
                    showToast('error', 'Ошибка', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        async function openReportDetails(reportId) {
            try {
                const r = await fetch('/api/v1/reports/' + reportId, { headers: { Authorization: 'Bearer ' + token } });
                if (!r.ok) return;
                const d = await r.json();
                const report = d.report;

                if (!report) return;

                // Загружаем актуальные данные пользователя через API
                const profileRes = await fetch('/api/v1/users/' + report.reported_user_id + '/profile', {
                    headers: { Authorization: 'Bearer ' + token }
                });
                let userData = {
                    id: report.reported_user_id,
                    name: report.reported_first_name || report.reported_username || 'Пользователь',
                    username: report.reported_username || '',
                    avatarUrl: report.reported_avatar_url || '',
                    bio: `Жалоба: ${getReasonLabel(report.reason)}\n${report.description || ''}`,
                    online: false,
                    isBot: false,
                    isBlocked: false
                };

                if (profileRes.ok) {
                    const profileData = await profileRes.json();
                    userData = {
                        id: profileData.user.id,
                        name: profileData.user.firstName || profileData.user.username || 'Пользователь',
                        username: profileData.user.username || '',
                        avatarUrl: profileData.user.avatarUrl || '',
                        bio: `Жалоба: ${getReasonLabel(report.reason)}\n${report.description || ''}`,
                        online: false,
                        isBot: false,
                        isBlocked: profileData.user.isBlocked || false,
                        isMuted: profileData.user.isMuted || false,
                        fromReport: true,
                        reportStatus: report.status,
                        reportId: report.id
                    };
                }

                // Открываем профиль
                openUserProfileModal(userData);

                // Закрываем панель жалоб
                reportsPanelOpen = false;
                document.getElementById('reportsPanel').style.display = 'none';
                document.getElementById('messages').style.display = 'flex';
            } catch (err) {
                console.error('Error loading report details:', err);
            }
        }

        async function loadSupportRequests() {
            const list = document.getElementById('supportList');
            list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">Загрузка...</div>';
            try {
                const r = await fetch('/api/v1/support/requests', { headers: { Authorization: 'Bearer ' + token } });
                if (!r.ok) { list.innerHTML = '<div style="color:#FF4B4B;padding:12px">Ошибка загрузки</div>'; return; }
                const d = await r.json();
                const requests = d.requests || [];
                if (!requests.length) {
                    list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px">Нет запросов</div>';
                    return;
                }
                list.innerHTML = requests.map(function(req) {
                    const name = ((req.first_name || '') + ' ' + (req.last_name || '')).trim() || req.username || 'Пользователь';
                    const av = req.avatar_url ? '<img src="' + req.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : name[0].toUpperCase();
                    const statusColor = req.status === 'open' ? '#FF007F' : '#00C864';
                    const statusLabel = req.status === 'open' ? 'Открыт' : 'Закрыт';
                    const time = new Date(req.created_at).toLocaleString('ru', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
                    return '<div style="background:var(--bg-secondary);border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer;border:1px solid var(--border-color)" onclick="openSupportChat(\'' + req.chat_id + '\',\'' + req.user_id + '\',\'' + req.id + '\')">'
                        + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
                        + '<div style="width:36px;height:36px;border-radius:50%;background:var(--accent-gradient);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">' + av + '</div>'
                        + '<div style="flex:1;min-width:0">'
                        + '<div style="font-size:14px;font-weight:600">' + name + ' <span style="color:var(--text-muted);font-weight:400;font-size:12px">@' + (req.username || '') + '</span></div>'
                        + '<div style="font-size:11px;color:var(--text-muted)">' + time + '</div>'
                        + '</div>'
                        + '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';background:' + statusColor + '22;padding:3px 8px;border-radius:6px;flex-shrink:0">' + statusLabel + '</span>'
                        + '</div>'
                        + '<div style="font-size:14px;color:var(--text-secondary);line-height:1.4;word-break:break-word">' + req.message + '</div>'
                        + '</div>';
                }).join('');
            } catch (e) {
                list.innerHTML = '<div style="color:#FF4B4B;padding:12px">Ошибка: ' + e.message + '</div>';
            }
        }

        async function openSupportChat(chatId, userId, requestId) {
            // Закрываем панель
            document.getElementById('supportPanel').style.display = 'none';
            document.getElementById('messages').style.display = 'flex';
            supportPanelOpen = false;

            if (!requestId || requestId === 'null') return;

            // Загружаем историю чата пользователя с ботом
            try {
                const r = await fetch('/api/v1/support/requests/' + requestId + '/messages', {
                    headers: { Authorization: 'Bearer ' + token }
                });
                if (!r.ok) { showToast('error', 'Ошибка загрузки', '❌'); return; }
                const d = await r.json();

                // Открываем модальный чат
                const modal = document.getElementById('supportChatModal');
                const userName = (d.user.first_name || d.user.username || 'Пользователь');
                document.getElementById('supportChatUserName').textContent = userName;
                modal.dataset.requestId = requestId;
                modal.dataset.chatId = d.chatId || '';
                modal.dataset.status = d.status || 'open';

                // Блокируем ввод если запрос закрыт
                const input = document.getElementById('supportChatInput');
                const sendBtn = modal.querySelector('button[onclick="sendSupportReply()"]');
                const isClosed = d.status === 'closed';
                input.disabled = isClosed;
            input.placeholder = isClosed ? (window.i18n?.t('requestClosedPlaceholder') || 'Запрос закрыт — ответить нельзя') : (window.i18n?.t('supportReplyPlaceholder') || 'Ответить от имени CraneApp...');
                input.style.opacity = isClosed ? '0.5' : '1';
                if (sendBtn) sendBtn.style.opacity = isClosed ? '0.4' : '1';

                // Рендерим сообщения
                const msgsEl = document.getElementById('supportChatMessages');
                msgsEl.innerHTML = '';
                (d.messages || []).forEach(function(m) {
                    const isBot = m.is_bot;
                    const div = document.createElement('div');
                    div.style.cssText = 'max-width:80%;padding:10px 14px;border-radius:16px;font-size:15px;line-height:1.4;word-break:break-word;'
                        + (isBot
                            ? 'background:var(--accent-gradient);color:#fff;align-self:flex-end;border-bottom-right-radius:4px;margin-left:auto'
                            : 'background:var(--bg-secondary);align-self:flex-start;border-bottom-left-radius:4px');
                    div.textContent = m.content;
                    msgsEl.appendChild(div);
                });
                msgsEl.scrollTop = 99999;

                modal.style.display = 'flex';
                document.getElementById('supportChatInput').focus();
            } catch (e) {
                showToast('error', 'Ошибка: ' + e.message, '❌');
            }
        }

        function closeSupportChatModal() {
            document.getElementById('supportChatModal').style.display = 'none';
            document.getElementById('supportChatInput').value = '';
        }

        async function sendSupportReply() {
            const input = document.getElementById('supportChatInput');
            const text = input.value.trim();
            if (!text) return;

            const modal = document.getElementById('supportChatModal');
            const requestId = modal.dataset.requestId;
            if (!requestId) return;

            try {
                const r = await fetch('/api/v1/support/requests/' + requestId + '/reply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                    body: JSON.stringify({ message: text })
                });

                if (r.ok) {
                    // Добавляем сообщение в чат
                    const msgsEl = document.getElementById('supportChatMessages');
                    const div = document.createElement('div');
                    div.style.cssText = 'max-width:80%;padding:10px 14px;border-radius:16px;font-size:15px;line-height:1.4;word-break:break-word;background:var(--accent-gradient);color:#fff;align-self:flex-end;border-bottom-right-radius:4px;margin-left:auto';
                    div.textContent = text;
                    msgsEl.appendChild(div);
                    msgsEl.scrollTop = 99999;
                    input.value = '';
                    input.style.height = 'auto';
                    showToast('success', 'Ответ отправлен', '✓');
                } else {
                    const d = await r.json();
                    showToast('error', d.error || 'Ошибка', '❌');
                }
            } catch (e) {
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        // Enter для отправки в support chat
        document.getElementById('supportChatInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSupportReply(); }
        });

        // ── Group Members & Moderation ───────────────────────────────────
        function pluralMembers(n) {
            if (n % 10 === 1 && n % 100 !== 11) return 'участник';
            if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'участника';
            return 'участников';
        }

        // Moderation functions
        function showMemberActionsMenu(idx) {
            const member = activeGroupMembers[idx];
            if (!member) return;
            selectedGroupMember = member;
            
            document.getElementById('memberActionsTitle').textContent = member.first_name || member.username;
            
            const currentMember = activeGroupMembers.find(m => m.id === user.id);
            const currentRole = currentMember ? currentMember.role : 'member';
            const isOwner = currentRole === 'owner';
            
            document.getElementById('modPromoteBtn').style.display = (isOwner && member.role === 'member') ? 'block' : 'none';
            document.getElementById('modDemoteBtn').style.display = (isOwner && member.role === 'admin') ? 'block' : 'none';
            
            const isMuted = member.muted_until && new Date(member.muted_until) > new Date();
            document.getElementById('modMuteBtn').style.display = !isMuted ? 'block' : 'none';
            document.getElementById('modUnmuteBtn').style.display = isMuted ? 'block' : 'none';
            
            document.getElementById('memberActionsModal').classList.add('active');
        }

        function closeMemberActions() {
            document.getElementById('memberActionsModal').classList.remove('active');
        }

        async function kickGroupMember() {
            if (!selectedGroupMember || !activeChat) return;
            if (!confirm(`Исключить пользователя ${selectedGroupMember.first_name || selectedGroupMember.username}?`)) return;
            
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/members/${selectedGroupMember.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || 'Ошибка при исключении');
                }
                showToast('success', 'Пользователь исключен', '✓');
                closeMemberActions();
                openGroupInfoModal(activeChat.id);
            } catch (e) {
                showToast('error', e.message, '❌');
            }
        }

        async function unmuteGroupMember() {
            if (!selectedGroupMember || !activeChat) return;
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/members/${selectedGroupMember.id}/unmute`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error();
                showToast('success', 'Ограничения сняты', '🔊');
                closeMemberActions();
                openGroupInfoModal(activeChat.id);
            } catch (e) {
                showToast('error', 'Не удалось снять ограничения', '❌');
            }
        }

        function openGroupDurationModal(action) {
            groupDurationAction = action;
            document.getElementById('groupDurationTitle').textContent = action === 'mute' ? 'Заглушить на...' : 'Забанить на...';
            document.getElementById('groupDurationReason').value = '';
            document.getElementById('groupDurationModal').classList.add('active');
        }

        function closeGroupDurationModal() {
            document.getElementById('groupDurationModal').classList.remove('active');
        }

        async function applyGroupDuration(duration) {
            if (!selectedGroupMember || !activeChat) return;
            const reason = document.getElementById('groupDurationReason').value.trim();
            const endpoint = groupDurationAction === 'mute' ? 'mute' : 'ban';
            
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/members/${selectedGroupMember.id}/${endpoint}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ duration, reason })
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || 'Ошибка действия');
                }
                showToast('success', groupDurationAction === 'mute' ? 'Пользователь заглушен' : 'Пользователь забанен', '✓');
                closeGroupDurationModal();
                closeMemberActions();
                openGroupInfoModal(activeChat.id);
            } catch (e) {
                showToast('error', e.message, '❌');
            }
        }

        function openAdminPermissions() {
            if (!selectedGroupMember) return;
            const perms = selectedGroupMember.permissions || {};
            document.getElementById('permChangeInfo').checked = perms.can_change_info !== false;
            document.getElementById('permDeleteMessages').checked = perms.can_delete_messages !== false;
            document.getElementById('permBanUsers').checked = perms.can_ban_users !== false;
            document.getElementById('permInviteUsers').checked = perms.can_invite_users !== false;
            document.getElementById('permPinMessages').checked = perms.can_pin_messages !== false;
            
            document.getElementById('adminPermissionsModal').classList.add('active');
        }

        function closeAdminPermissions() {
            document.getElementById('adminPermissionsModal').classList.remove('active');
        }

        async function saveAdminPermissions() {
            if (!selectedGroupMember || !activeChat) return;
            const permissions = {
                can_change_info: document.getElementById('permChangeInfo').checked,
                can_delete_messages: document.getElementById('permDeleteMessages').checked,
                can_ban_users: document.getElementById('permBanUsers').checked,
                can_invite_users: document.getElementById('permInviteUsers').checked,
                can_pin_messages: document.getElementById('permPinMessages').checked
            };
            
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/members/${selectedGroupMember.id}/role`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({
                        newRole: 'admin',
                        permissions
                    })
                });
                if (!res.ok) throw new Error();
                showToast('success', 'Назначен администратором', '👑');
                closeAdminPermissions();
                closeMemberActions();
                openGroupInfoModal(activeChat.id);
            } catch (e) {
                showToast('error', 'Не удалось обновить роль', '❌');
            }
        }

        async function demoteAdmin() {
            if (!selectedGroupMember || !activeChat) return;
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/members/${selectedGroupMember.id}/role`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({
                        newRole: 'member'
                    })
                });
                if (!res.ok) throw new Error();
                showToast('success', 'Администратор разжалован', '✓');
                closeMemberActions();
                openGroupInfoModal(activeChat.id);
            } catch (e) {
                showToast('error', 'Не удалось разжаловать', '❌');
            }
        }

        async function openBannedUsersModal() {
            if (!activeChat) return;
            document.getElementById('bannedUsersModal').classList.add('active');
            const list = document.getElementById('bannedUsersList');
            list.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);">Загрузка...</div>';
            
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/bans`, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error();
                const data = await res.json();
                list.innerHTML = data.bans.map(ban => {
                    const u = ban.user;
                    const name = (u.first_name || '') + (u.last_name ? ' ' + u.last_name : '') || u.username;
                    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-color);">
                        <div>
                            <div style="font-size:14px;font-weight:500;">${name}</div>
                            <div style="font-size:11px;color:var(--text-muted);">@${u.username}</div>
                        </div>
                        <button onclick="unbanGroupMember('${u.id}')" style="background:var(--bg-tertiary);border:1px solid var(--border-color);color:var(--text-primary);padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;">Разбанить</button>
                    </div>`;
                }).join('') || '<div style="padding:10px;text-align:center;color:var(--text-muted);">Нет заблокированных</div>';
            } catch (e) {
                list.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);">Ошибка загрузки</div>';
            }
        }

        function closeBannedUsersModal() {
            document.getElementById('bannedUsersModal').classList.remove('active');
        }

        async function unbanGroupMember(userId) {
            if (!activeChat) return;
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/members/${userId}/unban`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error();
                showToast('success', 'Пользователь разбанен', '✓');
                openBannedUsersModal();
                openGroupInfoModal(activeChat.id);
            } catch (e) {
                showToast('error', 'Не удалось разбанить', '❌');
            }
        }

        function openGroupInviteModal() {
            document.getElementById('groupInviteSearch').value = '';
            document.getElementById('groupInviteList').innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);">Введите имя для поиска</div>';
            document.getElementById('groupInviteModal').classList.add('active');
        }

        function closeGroupInviteModal() {
            document.getElementById('groupInviteModal').classList.remove('active');
        }

        async function searchGroupInviteMembers(queryStr) {
            const list = document.getElementById('groupInviteList');
            if (!queryStr || queryStr.trim().length === 0) {
                list.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);">Введите имя для поиска</div>';
                return;
            }
            
            try {
                const res = await fetch('/api/v1/users/search?q=' + encodeURIComponent(queryStr), {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error();
                const data = await res.json();
                
                const existingIds = new Set(activeGroupMembers.map(m => m.id));
                const filtered = data.users.filter(u => !existingIds.has(u.id));
                
                list.innerHTML = filtered.map(u => {
                    const name = (u.firstName || '') + (u.lastName ? ' ' + u.lastName : '') || u.username;
                    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-color);">
                        <div>
                            <div style="font-size:14px;font-weight:500;">${name}</div>
                            <div style="font-size:11px;color:var(--text-muted);">@${u.username}</div>
                        </div>
                        <button onclick="inviteUserToGroup('${u.id}')" style="background:var(--accent-gradient);border:none;color:white;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;">Пригласить</button>
                    </div>`;
                }).join('') || '<div style="padding:10px;text-align:center;color:var(--text-muted);">Пользователи не найдены</div>';
            } catch (e) {
                list.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);">Ошибка поиска</div>';
            }
        }

        async function inviteUserToGroup(userId) {
            if (!activeChat) return;
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/members`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ userId })
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || 'Ошибка приглашения');
                }
                showToast('success', 'Пользователь добавлен', '✓');
                closeGroupInviteModal();
                openGroupInfoModal(activeChat.id);
            } catch (e) {
                showToast('error', e.message, '❌');
            }
        }

                // ============================================
        // INVITE LINKS & JOIN REQUESTS (FRONTEND)
        // ============================================
        function copyToClipboard(text, successMsg) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('success', successMsg, '📋');
            }).catch(() => {
                showToast('error', 'Ошибка копирования', '❌');
            });
        }

        async function openInviteLinksModal() {
            if (!activeChat) return;
            document.getElementById('inviteLinksModal').classList.add('active');
            document.getElementById('linkRequestToJoin').checked = false;
            document.getElementById('linkUsageLimit').value = '';
            
            const listEl = document.getElementById('inviteLinksList');
            listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;text-align:center;">Загрузка ссылок...</div>';

            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/invite-links`, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const data = await res.json();
                    const links = data.inviteLinks || [];
                    if (links.length === 0) {
                        listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;text-align:center;">Активных ссылок нет</div>';
                        return;
                    }
                    listEl.innerHTML = links.map(link => {
                        const baseUrl = window.location.origin;
                        const fullUrl = `${baseUrl}/join/${link.link_code}`;
                        const reqLabel = link.request_to_join ? 'Нужно одобрение' : 'Вход прямой';
                        const limitLabel = link.usage_limit ? `Лимит: ${link.usage_count}/${link.usage_limit}` : `Использовано: ${link.usage_count}`;
                        
                        return `
                            <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;">
                                <div style="font-size:13px;font-weight:600;word-break:break-all;color:var(--accent-color);">${fullUrl}</div>
                                <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);">
                                    <span>${reqLabel}</span>
                                    <span>${limitLabel}</span>
                                </div>
                                <div style="display:flex;gap:6px;margin-top:2px;">
                                    <button onclick="copyToClipboard('${fullUrl}', 'Ссылка скопирована')" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">Копировать</button>
                                    <button onclick="revokeInviteLink('${link.id}')" style="background:rgba(255,75,75,0.1);border:1px solid rgba(255,75,75,0.2);color:#ff4b4b;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">Отозвать</button>
                                </div>
                            </div>
                        `;
                    }).join('');
                } else {
                    listEl.innerHTML = '<div style="color:#ff4b4b;font-size:13px;padding:8px 0;text-align:center;">Ошибка загрузки</div>';
                }
            } catch (err) {
                listEl.innerHTML = '<div style="color:#ff4b4b;font-size:13px;padding:8px 0;text-align:center;">Ошибка сети</div>';
            }
        }

        function closeInviteLinksModal() {
            document.getElementById('inviteLinksModal').classList.remove('active');
        }

        async function generateInviteLink() {
            if (!activeChat) return;
            const requestToJoin = document.getElementById('linkRequestToJoin').checked;
            const usageLimitVal = document.getElementById('linkUsageLimit').value;
            const usageLimit = usageLimitVal ? parseInt(usageLimitVal) : null;

            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/invite-links`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ requestToJoin, usageLimit })
                });
                if (res.ok) {
                    showToast('success', 'Ссылка успешно создана', '✓');
                    openInviteLinksModal();
                } else {
                    const err = await res.json();
                    showToast('error', err.error || 'Ошибка создания ссылки', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        async function revokeInviteLink(linkId) {
            if (!activeChat) return;
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/invite-links/${linkId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    showToast('success', 'Ссылка отозвана', '✓');
                    openInviteLinksModal();
                } else {
                    showToast('error', 'Не удалось отозвать ссылку', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        async function openJoinRequestsModal() {
            if (!activeChat) return;
            document.getElementById('joinRequestsModal').classList.add('active');

            const listEl = document.getElementById('joinRequestsList');
            listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;text-align:center;">Загрузка заявок...</div>';

            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/join-requests`, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const data = await res.json();
                    const reqs = data.joinRequests || [];
                    if (reqs.length === 0) {
                        listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;text-align:center;">Новых заявок нет</div>';
                        return;
                    }
                    listEl.innerHTML = reqs.map(req => {
                        const u = req.user;
                        const name = (u.first_name || '') + (u.last_name ? ' ' + u.last_name : '') || u.username;
                        
                        return `
                            <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:10px;padding:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
                                <div style="min-width:0;flex:1;">
                                    <div style="font-size:13px;font-weight:600;word-break:break-all;">${name}</div>
                                    <div style="font-size:11px;color:var(--text-muted);">@${u.username}</div>
                                </div>
                                <div style="display:flex;gap:4px;">
                                    <button onclick="decideJoinRequest('${req.id}', true)" style="background:rgba(0,230,118,0.15);border:1px solid rgba(0,230,118,0.3);color:#00E676;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">Принять</button>
                                    <button onclick="decideJoinRequest('${req.id}', false)" style="background:rgba(255,75,75,0.15);border:1px solid rgba(255,75,75,0.3);color:#ff4b4b;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">Отклонить</button>
                                </div>
                            </div>
                        `;
                    }).join('');
                } else {
                    listEl.innerHTML = '<div style="color:#ff4b4b;font-size:13px;padding:8px 0;text-align:center;">Ошибка загрузки</div>';
                }
            } catch (err) {
                listEl.innerHTML = '<div style="color:#ff4b4b;font-size:13px;padding:8px 0;text-align:center;">Ошибка сети</div>';
            }
        }

        function closeJoinRequestsModal() {
            document.getElementById('joinRequestsModal').classList.remove('active');
        }

        async function decideJoinRequest(requestId, approve) {
            if (!activeChat) return;
            const action = approve ? 'approve' : 'decline';
            try {
                const res = await fetch(`/api/v1/chats/${activeChat.id}/join-requests/${requestId}/${action}`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    showToast('success', approve ? 'Заявка одобрена' : 'Заявка отклонена', '✓');
                    openJoinRequestsModal();
                    if (approve) {
                        openGroupInfoModal(activeChat.id);
                    }
                } else {
                    showToast('error', 'Не удалось обработать заявку', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка сети', '❌');
            }
        }

        async function handlePendingJoinCode() {
            const pendingCode = localStorage.getItem('crane_pending_join_code') || new URLSearchParams(window.location.search).get('join');
            if (!pendingCode) return;

            localStorage.removeItem('crane_pending_join_code');
            const cleanUrl = window.location.pathname;
            history.replaceState({}, '', cleanUrl);

            await handleInviteLinkClick(pendingCode);
        }

        async function handleInviteLinkClick(code) {
            try {
                const res = await fetch('/api/v1/chats/join-link/' + code, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    }
                });
                const data = await res.json();
                if (res.ok) {
                    if (data.alreadyMember) {
                        showToast('info', 'Вы уже состоите в этой группе', '✓');
                        await loadChats();
                        const chat = allChats.find(c => c.id === data.chatId);
                        openChat(data.chatId, chat?.name || chat?.title || 'Группа');
                    } else if (data.joined) {
                        showToast('success', 'Вы успешно вступили в группу', '✓');
                        await loadChats();
                        const chat = allChats.find(c => c.id === data.chatId);
                        openChat(data.chatId, chat?.name || chat?.title || 'Группа');
                    } else if (data.approvalRequired) {
                        showToast('success', 'Заявка на вступление отправлена', '📝');
                    }
                } else {
                    showToast('error', data.error || 'Ошибка вступления по ссылке', '❌');
                }
            } catch (err) {
                showToast('error', 'Ошибка сети при вступлении по ссылке', '❌');
            }
        }


// Expose functions globally
        window.showMemberActionsMenu = showMemberActionsMenu;
        window.closeMemberActions = closeMemberActions;
        window.kickGroupMember = kickGroupMember;
        window.unmuteGroupMember = unmuteGroupMember;
        window.openGroupDurationModal = openGroupDurationModal;
        window.closeGroupDurationModal = closeGroupDurationModal;
        window.applyGroupDuration = applyGroupDuration;
        window.openAdminPermissions = openAdminPermissions;
        window.closeAdminPermissions = closeAdminPermissions;
        window.saveAdminPermissions = saveAdminPermissions;
        window.demoteAdmin = demoteAdmin;
        window.openBannedUsersModal = openBannedUsersModal;
        window.closeBannedUsersModal = closeBannedUsersModal;
        window.unbanGroupMember = unbanGroupMember;
        window.openGroupInviteModal = openGroupInviteModal;
        window.closeGroupInviteModal = closeGroupInviteModal;
        window.searchGroupInviteMembers = searchGroupInviteMembers;
        window.inviteUserToGroup = inviteUserToGroup;

        // Click-outside listeners
        document.getElementById('memberActionsModal').addEventListener('click', function(e) {
            if (e.target.id === 'memberActionsModal') closeMemberActions();
        });
        document.getElementById('adminPermissionsModal').addEventListener('click', function(e) {
            if (e.target.id === 'adminPermissionsModal') closeAdminPermissions();
        });
        document.getElementById('groupDurationModal').addEventListener('click', function(e) {
            if (e.target.id === 'groupDurationModal') closeGroupDurationModal();
        });
        document.getElementById('bannedUsersModal').addEventListener('click', function(e) {
            if (e.target.id === 'bannedUsersModal') closeBannedUsersModal();
        });
        document.getElementById('groupInviteModal').addEventListener('click', function(e) {
            if (e.target.id === 'groupInviteModal') closeGroupInviteModal();
        });

        function handleGroupAvatar(input) {
            const file = input.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { showToast('error', 'Файл слишком большой', '❌'); return; }
            const reader = new FileReader();
            reader.onload = e => {
                groupAvatarBase64 = e.target.result;
                const preview = document.getElementById('groupAvatarPreview');
                preview.innerHTML = `<img src="${groupAvatarBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            };
            reader.readAsDataURL(file);
        }

        function searchGroupMembers(query) {
            clearTimeout(groupSearchTimeout);
            const list = document.getElementById('groupMemberList');
            if (!query || query.length < 2) {
                list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Начните вводить имя или @username</div>';
                return;
            }
            list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">Поиск...</div>';
            groupSearchTimeout = setTimeout(async () => {
                try {
                    const res = await fetch('/api/v1/users/search?q=' + encodeURIComponent(query.replace('@','')), {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    if (!res.ok) { list.innerHTML = ''; return; }
                    const data = await res.json();
                    const users = (data.users || []).filter(u => u.id !== user.id);
                    if (!users.length) {
                        list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Пользователи не найдены</div>';
                        return;
                    }
                    list.innerHTML = users.map(u => {
                        const name = ((u.firstName||'') + (u.lastName ? ' '+u.lastName : '')).trim() || u.username;
                        const checked = groupSelectedIds.has(u.id);
                        const av = u.avatarUrl ? `<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : name[0].toUpperCase();
                        return `<div data-uid="${u.id}" data-uname="${name.replace(/"/g,'&quot;')}" onclick="toggleGroupMember('${u.id}','${name.replace(/'/g,"\\'")}','${u.avatarUrl||''}')" style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-color);transition:background 0.15s;${checked?'background:rgba(255,0,127,0.08);':''}">
                            <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#FF007F,#9D00FF);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;flex-shrink:0;overflow:hidden;">${av}</div>
                            <div style="flex:1;"><div style="font-size:14px;font-weight:500;">${name}</div><div style="font-size:12px;color:var(--text-muted);">@${u.username}</div></div>
                            <div style="width:22px;height:22px;border-radius:50%;border:2px solid ${checked?'var(--accent-color)':'var(--border-color)'};background:${checked?'var(--accent-color)':'transparent'};display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;">${checked?'✓':''}</div>
                        </div>`;
                    }).join('');
                } catch (e) {
                    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Ошибка поиска</div>';
                }
            }, 400);
        }

        // Хранилище имён и аватарок выбранных участников
        const groupMemberNames = {};
        const groupMemberAvatars = {};

        function toggleGroupMember(id, name, avatarUrl) {
            if (groupSelectedIds.has(id)) {
                groupSelectedIds.delete(id);
                delete groupMemberNames[id];
                delete groupMemberAvatars[id];
            } else {
                groupSelectedIds.add(id);
                groupMemberNames[id] = name;
                groupMemberAvatars[id] = avatarUrl;
            }
            renderGroupSelected();
            const q = document.getElementById('groupMemberSearch').value;
            if (q.length >= 2) searchGroupMembers(q);
        }

        function renderGroupSelected() {
            const container = document.getElementById('groupSelectedMembers');
            if (!groupSelectedIds.size) { container.innerHTML = ''; return; }
            container.innerHTML = Array.from(groupSelectedIds).map(id => {
                const name = groupMemberNames[id] || '?';
                const av = groupMemberAvatars[id];
                const avatarContent = av
                    ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
                    : name[0].toUpperCase();
                return `<div style="display:flex;align-items:center;gap:6px;background:rgba(255,0,127,0.12);border:1px solid rgba(255,0,127,0.25);border-radius:20px;padding:4px 10px 4px 6px;font-size:13px;">
                    <div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#FF007F,#9D00FF);display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;overflow:hidden;">${avatarContent}</div>
                    <span>${name}</span>
                    <span onclick="toggleGroupMember('${id}','${name.replace(/'/g,"\\'")}','${(groupMemberAvatars[id]||'').replace(/'/g,"\\'")}'')" style="cursor:pointer;opacity:0.6;font-size:14px;margin-left:2px;">×</span>
                </div>`;
            }).join('');
        }

        async function submitCreateGroup() {
            const title = document.getElementById('groupTitleInput').value.trim();
            if (!title) { showToast('error', 'Введите название группы', '❌'); return; }
            if (groupSelectedIds.size === 0) { showToast('error', 'Добавьте хотя бы одного участника', '❌'); return; }

            const btn = document.querySelector('#createGroupModal button[onclick="submitCreateGroup()"]');
            btn.disabled = true; btn.textContent = 'Создание...';

            try {
                const body = {
                    title,
                    description: document.getElementById('groupDescInput').value.trim(),
                    members: Array.from(groupSelectedIds)
                };
                if (groupAvatarBase64) body.avatar = groupAvatarBase64;

                const res = await fetch('/api/v1/chats/create-group', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (res.ok) {
                    closeCreateGroupModal();
                    showToast('success', `Группа "${title}" создана`, '✓');
                    await loadChats();
                    setTimeout(() => {
                        const chat = allChats.find(c => c.id === data.chatId);
                        if (chat) openChat(chat.id, chat.name || chat.title || title);
                    }, 500);
                } else {
                    showToast('error', data.error || 'Ошибка создания', '❌');
                }
            } catch (e) {
                showToast('error', 'Ошибка сети', '❌');
            } finally {
                btn.disabled = false; btn.textContent = 'Создать группу';
            }
        }

        document.getElementById('createGroupModal').addEventListener('click', function(e) {
            if (e.target.id === 'createGroupModal') closeCreateGroupModal();
        });
        
 // ============================================
 // CRANEAPP BOT GREETING - Session Check
 // ============================================
 function getDeviceInfo() {
 var ua = navigator.userAgent;
 var device = 'устройства';
            
 if (/mobile/i.test(ua)) {
 device = 'мобильного устройства';
 } else if (/tablet/i.test(ua)) {
 device = 'планшета';
 } else if (/iPad/i.test(ua)) {
 device = 'iPad';
 } else if (/iPhone/i.test(ua)) {
 device = 'iPhone';
 } else if (/Android/i.test(ua)) {
 device = 'Android-устройства';
 } else if (/Windows/i.test(ua)) {
 device = 'Windows';
 } else if (/Mac/i.test(ua)) {
 device = 'Mac';
 } else if (/Linux/i.test(ua)) {
 device = 'Linux';
 }
            
 return device;
 }

 function getCurrentTime() {
 var now = new Date();
 var hours = now.getHours().toString().padStart(2, '0');
 var minutes = now.getMinutes().toString().padStart(2, '0');
 return hours + ':' + minutes;
 }

 function checkSessionAndShowGreeting() {
 fetch('/api/v1/auth/sessions', {
 headers: { 'Authorization': 'Bearer ' + token }
 })
 .then(function(res) { return res.json(); })
 .then(function(data) {
 if (data.sessions && data.sessions.length >0) {
 // Если есть более одной сессии
 if (data.sessions.length >1) {
 var device = getDeviceInfo();
 var time = getCurrentTime();
 var userName = user.firstName || user.username || 'пользователь';
                        
 var greetingMsg = 'Здравствуйте, ' + userName + ', кто-то вошел в ваш аккаунт с ' + device + ' в ' + time + '.\n\nЕсли это были не вы, НЕЗАМЕДЛИТЕЛЬНО завершите сеанс в настройках.';
                        
 showCraneAppGreeting(greetingMsg);
 }
 }
 })
 .catch(function(err) {
 console.error('Session check error:', err);
 });
 }

 function showCraneAppGreeting(message) {
 var container = document.getElementById('toastContainer');
            
 var toast = document.createElement('div');
 toast.className = 'toast craneapp-greeting';
 toast.innerHTML = '<div class="craneapp-greeting-header"><span>🤖 CraneApp</span></div>' +
 '<div class="craneapp-greeting-body">' + message.replace(/\n/g, '<br>') + '</div>';
            
 container.appendChild(toast);
            
 setTimeout(function() {
 toast.style.opacity = '0';
 setTimeout(function() { toast.remove(); },300);
 },10000);
 }

 // Запускаем проверку при загрузке
 checkSessionAndShowGreeting();

 // Обновляем вкладки папок при возврате на страницу
 window.addEventListener('focus', function() { initFolderTabs(); });
 document.addEventListener('visibilitychange', function() {
     if (!document.hidden) initFolderTabs();
 });

  // ============================================
  // TOPICS & THREADS (Phase 3)
  // ============================================

  let selectedTopicColor = '#00E676';
  let selectedTopicEmoji = '📁';

  function openCreateTopicModal() {
      if (!activeChat) return;
      document.getElementById('newTopicTitle').value = '';
      // Reset pickers
      document.querySelectorAll('#topicColorPicker .color-dot').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('#topicEmojiPicker .emoji-dot').forEach(el => el.classList.remove('active'));
      
      const defColor = document.querySelector('#topicColorPicker .color-dot[data-color="#00E676"]');
      if (defColor) defColor.classList.add('active');
      selectedTopicColor = '#00E676';

      const defEmoji = document.querySelector('#topicEmojiPicker .emoji-dot[data-emoji="📁"]');
      if (defEmoji) defEmoji.classList.add('active');
      selectedTopicEmoji = '📁';

      document.getElementById('createTopicModal').classList.add('active');
  }

  function closeCreateTopicModal() {
      document.getElementById('createTopicModal').classList.remove('active');
  }

  async function submitCreateTopic() {
      if (!activeChat) return;
      const title = document.getElementById('newTopicTitle').value.trim();
      if (!title) {
          showToast('error', 'Введите название темы', '⚠️');
          return;
      }

      try {
          const res = await fetch(`/api/v1/chats/${activeChat.id}/topics`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + token
              },
              body: JSON.stringify({
                  title: title,
                  iconColor: selectedTopicColor,
                  iconEmoji: selectedTopicEmoji
              })
          });

          if (res.ok) {
              showToast('success', 'Тема создана', '✓');
              closeCreateTopicModal();
              await loadTopics();
          } else {
              const errData = await res.json();
              showToast('error', errData.error || 'Ошибка при создании темы', '❌');
          }
      } catch (err) {
          showToast('error', 'Ошибка сети', '❌');
      }
  }

  async function loadTopics() {
      if (!activeChat) return;
      try {
          const res = await fetch(`/api/v1/chats/${activeChat.id}/topics`, {
              headers: { 'Authorization': 'Bearer ' + token }
          });
          if (res.ok) {
              const data = await res.json();
              renderTopicsList(data.topics || []);
          }
      } catch (err) {
          console.error('Error loading topics:', err);
      }
  }

  function renderTopicsList(topics) {
      const container = document.getElementById('topicsContainer');
      if (!container) return;

      if (topics.length === 0) {
          container.innerHTML = `
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:var(--text-muted);">
                  <span style="font-size:40px;margin-bottom:12px;">📁</span>
                  <div style="font-size:14px;">В этой группе пока нет тем. Создайте первую!</div>
              </div>`;
          return;
      }

      container.innerHTML = topics.map(t => {
          const statusBadge = t.is_closed ? `<span class="topic-badge-closed">🔒 Закрыта</span>` : '';
          const unreadBadge = t.unreadCount ? `<span class="topic-unread-badge">${t.unreadCount}</span>` : '';
          const color = t.icon_color || '#9d00ff';
          const emoji = t.icon_emoji || '💬';

          return `
              <div class="topic-item" onclick="selectTopic('${t.id}', '${t.title}', '${emoji}', '${color}', ${t.is_closed})">
                  <div class="topic-icon-wrap" style="color: ${color}; box-shadow: 0 0 15px ${color}33;">
                      ${emoji}
                  </div>
                  <div class="topic-info">
                      <div class="topic-title">${t.title}</div>
                      <div class="topic-meta">
                          <span>Сообщений: ${t.message_count || 0}</span>
                          ${statusBadge}
                      </div>
                  </div>
                  ${unreadBadge}
              </div>
          `;
      }).join('');
  }

  function selectTopic(topicId, title, emoji, color, isClosed) {
      activeTopic = {
          id: topicId === 'null' || topicId === 'undefined' || !topicId ? null : topicId,
          title: title,
          emoji: emoji,
          color: color,
          isClosed: isClosed
      };

      // Переключаем UI в режим переписки
      document.getElementById('topicsArea').style.display = 'none';
      document.getElementById('messagesArea').style.display = 'flex';
      
      // Включаем или выключаем инпут в зависимости от того, закрыта ли тема
      const inputArea = document.querySelector('.input-area');
      const replyBar = document.getElementById('replyBar');
      if (isClosed) {
          inputArea.style.display = 'none';
          replyBar.style.display = 'none';
          let closedBar = document.getElementById('topicClosedBar');
          if (!closedBar) {
              closedBar = document.createElement('div');
              closedBar.id = 'topicClosedBar';
              closedBar.className = 'topic-closed-bar';
              closedBar.textContent = '🔒 Тема закрыта';
              inputArea.parentNode.insertBefore(closedBar, inputArea);
          } else {
              closedBar.className = 'topic-closed-bar';
              closedBar.textContent = 'Эта тема закрыта.';
              closedBar.style.display = 'flex';
          }
      } else {
          inputArea.style.display = 'flex';
          const closedBar = document.getElementById('topicClosedBar');
          if (closedBar) closedBar.style.display = 'none';
      }

      // Настраиваем back-кнопки
      document.getElementById('chatBackBtn').style.display = 'none';
      document.getElementById('topicsBackBtn').style.display = 'block';

      // Обновляем шапку: меняем название чата на название темы
      document.getElementById('chatName').innerHTML = `<span style="color:${color};margin-right:6px;">${emoji}</span> ${title}`;
      document.getElementById('chatStatus').textContent = `Тема группы ${activeChat.name}`;

      // Загружаем сообщения для этой темы
      messagesData = {};
      document.getElementById('messages').innerHTML = '';
      loadMessages(activeChat.id, activeTopic.id);
  }

  function backToTopics() {
      activeTopic = null;
      
      // Скрываем сообщения и инпут, показываем темы
      document.getElementById('messagesArea').style.display = 'none';
      document.getElementById('topicsArea').style.display = 'flex';
      document.querySelector('.input-area').style.display = 'none';
      document.getElementById('replyBar').style.display = 'none';
      const closedBar = document.getElementById('topicClosedBar');
      if (closedBar) closedBar.style.display = 'none';

      // Настраиваем back-кнопки
      document.getElementById('chatBackBtn').style.display = 'block';
      document.getElementById('topicsBackBtn').style.display = 'none';

      // Восстанавливаем шапку чата
      document.getElementById('chatName').textContent = activeChat.name;
      document.getElementById('chatStatus').textContent = pluralMembers(activeGroupMembers.length);

      // Перезагружаем темы
      loadTopics();
  }

  // Settings Upgrade to Supergroup / Enable Topics
  async function upgradeToSupergroup() {
      if (!activeChat) return;
      try {
          const res = await fetch(`/api/v1/chats/${activeChat.id}/settings`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + token
              },
              body: JSON.stringify({ isSupergroup: true })
          });
          if (res.ok) {
              showToast('success', 'Темы успешно включены!', '✓');
              activeChat.isSupergroup = true;
              // Обновляем в allChats
              const found = allChats.find(c => c.id === activeChat.id);
              if (found) found.isSupergroup = true;

              const modal = document.getElementById('groupInfoModal');
              if (modal) modal.remove();
              
              // Перегружаем чат
              openChat(activeChat.id, activeChat.name);
          } else {
              const data = await res.json();
              showToast('error', data.error || 'Ошибка при включении тем', '❌');
          }
      } catch (err) {
          showToast('error', 'Ошибка сети', '❌');
      }
  }

  // Color & Emoji Picker click handlers for topic creation modal
  document.addEventListener('click', function(e) {
      if (e.target.classList.contains('color-dot')) {
          document.querySelectorAll('#topicColorPicker .color-dot').forEach(el => el.classList.remove('active'));
          e.target.classList.add('active');
          selectedTopicColor = e.target.getAttribute('data-color');
      }
      if (e.target.classList.contains('emoji-dot')) {
          document.querySelectorAll('#topicEmojiPicker .emoji-dot').forEach(el => el.classList.remove('active'));
          e.target.classList.add('active');
          selectedTopicEmoji = e.target.getAttribute('data-emoji');
      }
  });

  // Make functions globally available
  window.openCreateTopicModal = openCreateTopicModal;
  window.closeCreateTopicModal = closeCreateTopicModal;
  window.submitCreateTopic = submitCreateTopic;
  window.selectTopic = selectTopic;
  window.backToTopics = backToTopics;
  window.upgradeToSupergroup = upgradeToSupergroup;

  // Invite links & join requests bindings
  window.openInviteLinksModal = openInviteLinksModal;
  window.closeInviteLinksModal = closeInviteLinksModal;
  window.generateInviteLink = generateInviteLink;
  window.revokeInviteLink = revokeInviteLink;
  window.openJoinRequestsModal = openJoinRequestsModal;
  window.closeJoinRequestsModal = closeJoinRequestsModal;
  window.decideJoinRequest = decideJoinRequest;
  window.handleInviteLinkClick = handleInviteLinkClick;


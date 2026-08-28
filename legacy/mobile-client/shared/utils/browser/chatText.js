(function() {
    function createChatTextUtils(options) {
        const getActiveChat = options.getActiveChat || function() { return null; };
        const getChatUsers = options.getChatUsers || function() { return {}; };
        const pluralMembers = options.pluralMembers || function(count) { return 'members'; };

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

        return {
            botText,
            chatStatusText,
            formatI18n,
            isCraneAppBotMessage,
            localizeBotMessageText,
            tc,
            tr,
        };
    }

    window.CraneChatTextUtils = { create: createChatTextUtils };
})();

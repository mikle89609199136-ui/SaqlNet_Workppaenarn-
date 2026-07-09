/**
 * CraneApp Notification Service
 * Подключается к WebSocket и показывает уведомления о новых сообщениях
 */
(function () {
    let ws = null;
    let reconnectTimer = null;
    let reconnectDelay = 2000;

    function getToken() {
        return localStorage.getItem('craneapp_auth_token');
    }

    function getUserId() {
        const u = localStorage.getItem('craneapp_user_data');
        return u ? JSON.parse(u).id : null;
    }

    function getNotifSettings() {
        const saved = localStorage.getItem('craneapp_notification_settings');
        const defaults = {
            privateChats: true, groups: true, channels: true,
            inAppNotifications: true, messagePreview: true
        };
        return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    }

    // ── Браузерное разрешение ──────────────────────────────────────────────
    function requestPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    // ── Показать браузерное уведомление ───────────────────────────────────
    function showBrowserNotif(title, body, chatId) {
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;

        const n = new Notification(title, {
            body,
            icon: '/client/mobile/assets/icons/icon-192.png',
            tag: 'chat-' + chatId,
            renotify: true,
            silent: false
        });

        n.onclick = () => {
            window.focus();
            window.location.href = '/mobile/chats/' + encodeURIComponent(chatId);
            n.close();
        };

        setTimeout(() => n.close(), 5000);
    }

    // ── In-app тост ───────────────────────────────────────────────────────
    function showInAppToast(senderName, text, chatId) {
        // Не показываем если уже открыт этот чат
        const params = new URLSearchParams(window.location.search);
        if (window.location.pathname.includes('chat.html') && params.get('id') === chatId) return;

        let container = document.getElementById('_notifToastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = '_notifToastContainer';
            container.style.cssText = `
                position: fixed; top: calc(env(safe-area-inset-top, 0px) + 12px);
                left: 12px; right: 12px;
                z-index: 99998;
                display: flex; flex-direction: column; gap: 8px;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `
            background: #1E1E1E;
            border-radius: 14px;
            padding: 12px 14px;
            display: flex; align-items: center; gap: 12px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.5);
            cursor: pointer;
            pointer-events: all;
            animation: _notifSlideDown 0.3s ease;
            border-left: 3px solid var(--accent-color, #FF007F);
            max-width: 100%;
        `;

        const settings = getNotifSettings();
        const bodyText = settings.messagePreview ? (text.length > 60 ? text.slice(0, 60) + '…' : text) : 'Новое сообщение';

        toast.innerHTML = `
            <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#FF007F,#9D00FF);
                display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">💬</div>
            <div style="flex:1;overflow:hidden;">
                <div style="font-size:14px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(senderName)}</div>
                <div style="font-size:13px;color:#B0B0B0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(bodyText)}</div>
            </div>
            <div style="font-size:11px;color:#666;flex-shrink:0;">${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div>
        `;

        toast.onclick = () => {
            window.location.href = '/mobile/chats/' + encodeURIComponent(chatId);
        };

        container.appendChild(toast);

        // Анимация
        if (!document.getElementById('_notifStyle')) {
            const s = document.createElement('style');
            s.id = '_notifStyle';
            s.textContent = `
                @keyframes _notifSlideDown {
                    from { opacity:0; transform:translateY(-20px); }
                    to   { opacity:1; transform:translateY(0); }
                }
            `;
            document.head.appendChild(s);
        }

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Звук уведомления ──────────────────────────────────────────────────
    function playNotifSound() {
        const soundSettings = JSON.parse(localStorage.getItem('craneapp_sound_settings') || '{}');
        if (soundSettings.notificationsSound === false) return;
        const volume = soundSettings.notificationsVolume ?? 80;
        const soundId = soundSettings.notificationSound || 'default';

        if (window.CraneSounds) {
            window.CraneSounds.play(soundId, volume);
            return;
        }

        // Fallback если sounds.js не загружен
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(volume / 100 * 0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch (_) {}
    }
    function handleNewMessage(data) {
        const settings = getNotifSettings();
        const myId = getUserId();
        const msg = data.message;

        if (!msg) return;
        // Не уведомляем о своих сообщениях
        if (msg.senderId === myId || msg.sender_id === myId) return;

        // Фильтр по типу чата
        const chatType = data.chatType || 'private';
        if (chatType === 'private' && !settings.privateChats) return;
        if ((chatType === 'group' || chatType === 'supergroup') && !settings.groups) return;
        if (chatType === 'channel' && !settings.channels) return;

        // Если все уведомления отключены
        if (!settings.inAppNotifications && Notification.permission !== 'granted') return;

        const senderName = msg.sender?.firstName || msg.sender?.username
            || msg.senderName || msg.sender_name || 'Новое сообщение';
        // Для групп/каналов показываем название чата
        const displayName = (chatType !== 'private' && data.chatTitle)
            ? data.chatTitle
            : senderName;
        const text = msg.content || msg.text || '';
        const chatId = data.chatId || msg.chatId || msg.chat_id;

        if (settings.inAppNotifications) {
            showInAppToast(displayName, text, chatId);
            playNotifSound();
        }

        if (Notification.permission === 'granted' && !document.hasFocus()) {
            const body = settings.messagePreview
                ? (chatType !== 'private' ? `${senderName}: ${text}` : text)
                : 'Новое сообщение';
            showBrowserNotif(displayName, body, chatId);
        }
    }

    // ── WebSocket ──────────────────────────────────────────────────────────
    function connect() {
        const token = getToken();
        if (!token) return;

        // Не подключаемся на страницах авторизации
        const path = window.location.pathname;
        if (path.includes('/auth/') || path.includes('login.html') || path.includes('register.html')) return;

        // Если страница уже имеет свой WebSocket (chats.html) — не дублируем
        if (window._chatWsConnected) return;

        try {
            const proto = location.protocol === 'https:' ? 'wss' : 'ws';
            ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);

            ws.onopen = () => {
                reconnectDelay = 2000;
                console.log('🔔 Notification WS connected');
            };

            ws.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.type === 'new_message') {
                        handleNewMessage(data);
                    }
                    // Синхронизируем настройки при обновлении с другого устройства
                    if (data.type === 'settings_updated') {
                        if (window.syncThemeWithServer) window.syncThemeWithServer();
                    }
                } catch (_) {}
            };

            ws.onclose = () => {
                scheduleReconnect();
            };

            ws.onerror = () => {
                ws.close();
            };
        } catch (e) {
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
            connect();
        }, reconnectDelay);
    }

    // ── Инициализация ──────────────────────────────────────────────────────
    function init() {
        if (!getToken()) return;
        requestPermission();
        connect();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Переподключение при возврате на вкладку
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && (!ws || ws.readyState === WebSocket.CLOSED)) {
            connect();
        }
    });
})();

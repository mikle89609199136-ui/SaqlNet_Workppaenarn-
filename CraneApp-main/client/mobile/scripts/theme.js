/**
 * Global Theme Manager
 * Синхронизирует настройки темы между устройствами
 */

// ── Перехват ошибок API — выполняется ДО всего остального ─────────────────
(function() {
    if (window.location.pathname.includes('/error/')) return;
    const _origFetch = window.fetch;
    let _errShown = false;

    function _retryMin(res, body) {
        const h = res.headers.get('Retry-After');
        if (h) return Math.ceil(parseInt(h, 10) / 60);
        const m = (body?.error || '').match(/(\d+)\s*minute/i);
        return m ? parseInt(m[1], 10) : 1;
    }

    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const isApi = url.includes('/api/');
        try {
            const res = await _origFetch.apply(this, args);
            if (!isApi || _errShown) return res;
            if (res.status === 429 || res.status === 403) {
                const clone = res.clone();
                clone.json().then(body => {
                    if (_errShown) return; _errShown = true;
                    const min = _retryMin(res, body);
                    const msg = encodeURIComponent(body?.error || '');
                    location.href = '/mobile/rate-limit';
                }).catch(() => {
                    if (_errShown) return; _errShown = true;
                    location.href = '/mobile/rate-limit';
                });
            } else if (res.status === 502 || res.status === 503 || res.status === 504) {
                _errShown = true;
                location.href = '/server-down.html';
            }
            return res;
        } catch (e) {
            if (isApi && !_errShown) {
                _errShown = true;
                location.href = '/server-down.html';
            }
            throw e;
        }
    };
})();

(function() {
    const defaultSettings = {
        theme: 'dark',
        accentColor: '#FF007F',
        fontSize: 'medium'
    };

    function getSettings() {
        const saved = localStorage.getItem('craneapp_settings');
        return saved ? { ...defaultSettings, ...JSON.parse(saved) } : { ...defaultSettings };
    }

    function saveSettingsLocal(settings) {
        localStorage.setItem('craneapp_settings', JSON.stringify(settings));
    }

    function applyTheme() {
        const settings = getSettings();
        
        // Применяем тему
        document.documentElement.setAttribute('data-theme', settings.theme);
        
        // Применяем цвет акцента
        document.documentElement.style.setProperty('--accent-color', settings.accentColor);
        document.documentElement.style.setProperty('--accent-gradient', `linear-gradient(135deg, ${settings.accentColor}, #9D00FF)`);
        
        // Применяем размер шрифта
        const fontSizes = { small: '14px', medium: '16px', large: '18px' };
        const fontSize = fontSizes[settings.fontSize] || '16px';
        document.documentElement.style.setProperty('--base-font-size', fontSize);
        if (document.body) document.body.style.fontSize = fontSize;
        else document.addEventListener('DOMContentLoaded', () => { document.body.style.fontSize = fontSize; });
        
        console.log('🎨 Theme applied:', settings.theme, settings.accentColor, settings.fontSize);
    }

    // Синхронизация с сервером
    async function syncWithServer() {
        const token = localStorage.getItem('craneapp_auth_token');
        if (!token) return;

        try {
            const res = await fetch('/api/v2/users/all-settings', {
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (res.ok) {
                const data = await res.json();

                // Применяем каждую группу настроек в localStorage
                if (data.settings && Object.keys(data.settings).length) {
                    const local = getSettings();
                    // Мержим аккуратно: не затираем локальные значения пустыми серверными
                    const merged = { ...local };
                    if (data.settings.theme) merged.theme = data.settings.theme;
                    if (data.settings.accentColor) merged.accentColor = data.settings.accentColor;
                    if (data.settings.fontSize) merged.fontSize = data.settings.fontSize;
                    if (data.settings.language) {
                        merged.language = data.settings.language;
                        localStorage.setItem('craneapp_language', data.settings.language);
                        if (window.i18n?.setLanguage && window.i18n.currentLang !== data.settings.language) {
                            window.i18n.setLanguage(data.settings.language);
                        }
                    }
                    if (data.settings.notifications !== undefined) merged.notifications = data.settings.notifications;
                    if (data.settings.sounds !== undefined) merged.sounds = data.settings.sounds;
                    saveSettingsLocal(merged);
                    applyTheme();
                }
                if (data.notificationSettings && Object.keys(data.notificationSettings).length) {
                    localStorage.setItem('craneapp_notification_settings', JSON.stringify(data.notificationSettings));
                }
                if (data.privacySettings && Object.keys(data.privacySettings).length) {
                    localStorage.setItem('craneapp_privacy_settings', JSON.stringify(data.privacySettings));
                }
                if (data.soundSettings && Object.keys(data.soundSettings).length) {
                    localStorage.setItem('craneapp_sound_settings', JSON.stringify(data.soundSettings));
                }
                if (data.storageSettings && Object.keys(data.storageSettings).length) {
                    localStorage.setItem('craneapp_data_settings', JSON.stringify(data.storageSettings));
                }
                if (data.advancedSettings && Object.keys(data.advancedSettings).length) {
                    localStorage.setItem('craneapp_advanced_settings', JSON.stringify(data.advancedSettings));
                }
                if (data.folders && data.folders.length) {
                    localStorage.setItem('craneapp_folders', JSON.stringify(data.folders));
                }
                if (data.passcodeEnabled !== undefined) {
                    localStorage.setItem('craneapp_passcode_enabled', data.passcodeEnabled ? 'true' : 'false');
                }

                console.log('🔄 All settings synced from server');
            }
        } catch (e) {
            console.warn('⚠️ Settings sync failed:', e);
        }
    }

    // Сохранение настроек на сервер (универсальный)
    async function saveSettingsToServer(settings) {
        const token = localStorage.getItem('craneapp_auth_token');
        if (!token) return;

        try {
            await fetch('/api/v2/users/all-settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ settings })
            });
        } catch (e) {
            console.warn('⚠️ Failed to save settings to server:', e);
        }
    }

    // Слушаем settings_updated от других устройств через WebSocket
    function listenForSettingsUpdates() {
        const token = localStorage.getItem('craneapp_auth_token');
        const userData = localStorage.getItem('craneapp_user_data');
        if (!token || !userData) return;

        const userId = JSON.parse(userData).id;
        if (!userId) return;

        // Не создаём отдельный WS если страница уже имеет свой (chats.html)
        if (window._chatWsConnected) return;
        // Не создаём если уже есть (notifications.js создаст)
        window._settingsSyncRegistered = true;
    }

    // Обновить тему (для вызова снаружи)
    async function updateTheme(theme) {
        const settings = getSettings();
        settings.theme = theme;
        saveSettingsLocal(settings);
        applyTheme();
        await saveSettingsToServer(settings);
    }

    // Обновить цвет акцента (для вызова снаружи)
    async function updateAccentColor(color) {
        const settings = getSettings();
        settings.accentColor = color;
        saveSettingsLocal(settings);
        applyTheme();
        await saveSettingsToServer(settings);
    }

    // Обновить размер шрифта (для вызова снаружи)
    async function updateFontSize(size) {
        const settings = getSettings();
        settings.fontSize = size;
        saveSettingsLocal(settings);
        applyTheme();
        await saveSettingsToServer(settings);
    }

    // ============================================
    // PASSCODE LOCK
    // ============================================
    function isPasscodeEnabled() {
        return localStorage.getItem('craneapp_passcode_enabled') === 'true';
    }

    function isUnlocked() {
        return sessionStorage.getItem('craneapp_unlocked') === 'true';
    }

    function setUnlocked() {
        sessionStorage.setItem('craneapp_unlocked', 'true');
    }

    function isAuthPage() {
        const path = window.location.pathname;
        return path.includes('/auth/') 
            || path.includes('passcode.html')
            || path.includes('login.html')
            || path.includes('register.html')
            || path.includes('phoneVerification.html')
            || window.__isPasscodePage === true;
    }

    function showPasscodeLock() {
        if (isAuthPage()) return;
        if (!isPasscodeEnabled()) return;
        if (isUnlocked()) return;
        if (document.getElementById('passcodeLockOverlay')) return; // уже показан

        const overlay = document.createElement('div');
        overlay.id = 'passcodeLockOverlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: var(--bg-primary, #000);
            z-index: 99999;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            padding: 40px 24px;
            font-family: system-ui, -apple-system, sans-serif;
            color: var(--text-primary, #fff);
        `;

        const lockTitle = window.i18n?.t('passcodeLockedTitle') || 'CraneApp заблокирован';
        const lockDesc = window.i18n?.t('passcodeLockedDesc') || 'Введите код-пароль для продолжения';

        overlay.innerHTML = `
            <div style="font-size:48px;margin-bottom:16px;">🔐</div>
            <div style="font-size:22px;font-weight:700;margin-bottom:8px;">${lockTitle}</div>
            <div style="font-size:14px;color:#B0B0B0;margin-bottom:40px;">${lockDesc}</div>
            <div id="lockDots" style="display:flex;gap:16px;margin-bottom:40px;">
                <div id="ld0" style="width:16px;height:16px;border-radius:50%;border:2px solid #666;transition:all 0.15s;"></div>
                <div id="ld1" style="width:16px;height:16px;border-radius:50%;border:2px solid #666;transition:all 0.15s;"></div>
                <div id="ld2" style="width:16px;height:16px;border-radius:50%;border:2px solid #666;transition:all 0.15s;"></div>
                <div id="ld3" style="width:16px;height:16px;border-radius:50%;border:2px solid #666;transition:all 0.15s;"></div>
            </div>
            <div id="lockNumpad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;width:100%;max-width:280px;"></div>
            <div id="lockError" style="margin-top:20px;color:#FF4B4B;font-size:14px;min-height:20px;"></div>
        `;

        document.body.appendChild(overlay);

        let buf = '';
        let attempts = 0;

        function updateDots(state) {
            for (let i = 0; i < 4; i++) {
                const d = overlay.querySelector('#ld' + i);
                if (!d) return;
                if (state === 'error') {
                    d.style.background = '#FF4B4B';
                    d.style.borderColor = '#FF4B4B';
                } else if (i < buf.length) {
                    d.style.background = 'var(--accent-color, #FF007F)';
                    d.style.borderColor = 'var(--accent-color, #FF007F)';
                } else {
                    d.style.background = 'transparent';
                    d.style.borderColor = '#666';
                }
            }
        }

        async function checkCode() {
            const token = localStorage.getItem('craneapp_auth_token');
            try {
                const res = await fetch('/api/v2/users/passcode/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ passcode: buf })
                });
                if (res.ok) {
                    setUnlocked();
                    overlay.remove();
                } else {
                    fail();
                }
            } catch (e) {
                const stored = localStorage.getItem('craneapp_passcode');
                if (stored && stored === buf) {
                    setUnlocked();
                    overlay.remove();
                } else {
                    fail();
                }
            }
        }

        function fail() {
            attempts++;
            updateDots('error');
            const errEl = overlay.querySelector('#lockError');
            if (errEl) errEl.textContent = attempts >= 5
                ? (window.i18n?.t('passcodeTooMany') || 'Слишком много попыток. Войдите заново.')
                : (window.i18n?.t('passcodeWrong') || 'Неверный код');
            const dots = overlay.querySelector('#lockDots');
            if (dots) {
                dots.style.animation = 'lockShake 0.4s ease';
                setTimeout(() => { dots.style.animation = ''; }, 400);
            }
            if (attempts >= 5) {
                setTimeout(() => {
                    localStorage.removeItem('craneapp_auth_token');
                    localStorage.removeItem('craneapp_user_data');
                    window.location.href = '/mobile/login';
                }, 1500);
                return;
            }
            setTimeout(() => { buf = ''; updateDots(); }, 500);
        }

        // Строим кнопки через JS, не через innerHTML с onclick
        const numpadKeys = ['1','2','3','4','5','6','7','8','9','','0','DEL'];
        const numpad = overlay.querySelector('#lockNumpad');
        numpadKeys.forEach(k => {
            const btn = document.createElement('button');
            btn.textContent = k === 'DEL' ? '⌫' : k;
            btn.style.cssText = `
                height:72px; border-radius:50%; border:none;
                background:${k === '' ? 'transparent' : 'rgba(255,255,255,0.08)'};
                color:var(--text-primary,#fff); font-size:24px; font-weight:500;
                cursor:${k === '' ? 'default' : 'pointer'};
                display:flex; align-items:center; justify-content:center;
                transition:background 0.1s; width:100%;
            `;
            if (k === '') {
                btn.disabled = true;
            } else {
                btn.addEventListener('click', () => {
                    if (k === 'DEL') {
                        buf = buf.slice(0, -1);
                        updateDots();
                    } else if (buf.length < 4) {
                        buf += k;
                        updateDots();
                        if (buf.length === 4) setTimeout(checkCode, 150);
                    }
                });
            }
            numpad.appendChild(btn);
        });

        // Анимация shake
        if (!document.getElementById('lockShakeStyle')) {
            const style = document.createElement('style');
            style.id = 'lockShakeStyle';
            style.textContent = '@keyframes lockShake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }';
            document.head.appendChild(style);
        }
    }

    // Service Worker — офлайн страница при полном отключении сервера
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/client/mobile/scripts/sw.js').catch(() => {});
    }

    // Применяем локальную тему сразу
    applyTheme();

    // Подключаем глобальные стили и анимации
    (function loadStyles() {
        if (!document.getElementById('craneAnimations')) {
            const a = document.createElement('link');
            a.id = 'craneAnimations';
            a.rel = 'stylesheet';
            a.href = '/client/mobile/styles/animations.css';
            document.head.appendChild(a);
        }
        if (!document.getElementById('craneGlobal')) {
            const g = document.createElement('link');
            g.id = 'craneGlobal';
            g.rel = 'stylesheet';
            g.href = '/client/mobile/styles/global.css';
            document.head.appendChild(g);
        }
        // Apple Emoji уже подключены отдельным скриптом
        // Twemoji отключён
    })();

    // Показываем блокировку если нужно
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showPasscodeLock);
    } else {
        showPasscodeLock();
    }

    // Синхронизируем с сервером после загрузки страницы
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncWithServer);
    } else {
        syncWithServer();
    }

    // Применяем при возврате на страницу
    window.addEventListener('pageshow', () => {
        applyTheme();
        syncWithServer();
        if (!isAuthPage()) showPasscodeLock();
    });

    // Глобальные функции
    window.applyTheme = applyTheme;
    window.syncThemeWithServer = syncWithServer;
    window.updateTheme = updateTheme;
    window.updateAccentColor = updateAccentColor;
    window.updateFontSize = updateFontSize;

    // Подключаем сервис уведомлений
    (function loadNotifications() {
        const path = window.location.pathname;
        if (path.includes('/auth/') || path.includes('login.html') || path.includes('register.html')) return;
        const s = document.createElement('script');
        s.src = '/client/mobile/scripts/notifications.js';
        document.head.appendChild(s);
    })();

    // Подключаем Apple Emoji на всех экранах
    (function loadAppleEmoji() {
        if (document.getElementById('apple-emoji-script')) return;
        const s = document.createElement('script');
        s.id = 'apple-emoji-script';
        s.src = '/client/mobile/scripts/apple-emoji.js';
        document.head.appendChild(s);
    })();
    // Подключаем E2E шифрование
    (function loadE2E() {
        const path = window.location.pathname;
        if (path.includes('/auth/') || path.includes('login.html') || path.includes('register.html')) return;
        if (document.getElementById('e2e-crypto-script')) return;

        // Сначала загружаем постквантовую библиотеку
        const pq = document.createElement('script');
        pq.id = 'pq-crypto-script';
        pq.src = '/client/mobile/scripts/pq-crypto.js';
        pq.onload = () => {
            const s = document.createElement('script');
            s.id = 'e2e-crypto-script';
            s.src = '/client/mobile/scripts/e2e-crypto.js';
            s.onload = () => {
                const mls = document.createElement('script');
                mls.id = 'mls-crypto-script';
                mls.src = '/client/mobile/scripts/mls-crypto.js';
                mls.onload = () => {
                    const token = localStorage.getItem('craneapp_auth_token');
                    if (token) {
                        if (window.E2E) window.E2E.init(token);
                        if (window.MLS) window.MLS.init(token);
                    }
                };
                document.head.appendChild(mls);
            };
            document.head.appendChild(s);
        };
        document.head.appendChild(pq);
    })();
    (function loadSounds() {
        const s = document.createElement('script');
        s.src = '/client/mobile/assets/sounds/sounds.js';
        document.head.appendChild(s);
    })();

    // Применяем язык через единый i18n runtime
    (function applyLanguage() {
        const apply = () => window.i18n && window.i18n.translatePage();

        if (window.i18n) {
            apply();
            return;
        }

        const existing = document.querySelector('script[src$="/scripts/i18n.js"],script[src*="scripts/i18n.js"]');
        if (existing) {
            existing.addEventListener('load', apply, { once: true });
            setTimeout(apply, 200);
            return;
        }

        const s = document.createElement('script');
        s.id = 'crane-i18n-script';
        s.src = '/client/mobile/scripts/i18n.js';
        s.onload = apply;
        document.head.appendChild(s);
    })();

    // Заменяем эмодзи в иконках настроек на SVG
    (function replaceSettingsIcons() {
        const M = {
            '👤':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
            '🔒':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
            '🔐':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
            '📱':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
            '🔔':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
            '🎵':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
            '🎨':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
            '🌐':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
            '📁':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
            '💾':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
            '⚙':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
            '⭐':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
            '❓':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            'ℹ':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
            '💬':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
            '📢':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
            '📞':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.99 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.9 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
            '📹':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
            '👁':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
            '🗑':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
            '📊':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
            '🔄':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
            '⚡':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
            '📈':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
            '🔧':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
            '📋':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
            '📤':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>',
            '🎬':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>',
            '🖼':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
            '📳':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
            '⏱':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            '📶':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="6" x2="1" y2="18"/><line x1="6" y1="11" x2="6" y2="18"/><line x1="11" y1="8" x2="11" y2="18"/><line x1="16" y1="5" x2="16" y2="18"/><line x1="21" y1="2" x2="21" y2="18"/></svg>',
            '📡':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
            '✉':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
            '👥':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        };
        function apply(root) {
            (root.querySelectorAll ? root : document).querySelectorAll('.item-icon, .settings-icon').forEach(el => {
                const t = el.textContent.trim();
                if (M[t] && !el.querySelector('svg')) {
                    el.innerHTML = M[t];
                    el.style.cssText += ';display:flex;align-items:center;justify-content:center;';
                }
            });
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply(document));
        else apply(document);
        new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType===1) apply(n); }))).observe(document.documentElement, {childList:true, subtree:true});
    })();

})();

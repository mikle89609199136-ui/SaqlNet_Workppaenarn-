// ============================================
        // INIT
        // ============================================
        const token = localStorage.getItem('craneapp_auth_token');
        let user = JSON.parse(localStorage.getItem('craneapp_user_data') || '{}');
        let serverSettings = {};
        
        if (!token) {
            window.location.href = '../auth/login.html';
        }

        // ============================================
        // SYNC FUNCTIONS
        // ============================================
        async function syncUserData() {
            try {
                const res = await fetch('/api/v1/users/me', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                if (res.ok) {
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
                            isPremium: data.user.isPremium || false
                        };
                        
                        localStorage.setItem('craneapp_user_data', JSON.stringify(user));
                        updateProfileDisplay();
                        
                        console.log('✅ User data synced');
                    }
                }
            } catch (e) {
                console.warn('⚠️ User sync failed:', e);
            }
        }

        async function syncSettings() {
            updateSyncIndicator('syncing');
            
            try {
                const res = await fetch('/api/v1/users/all-settings', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                if (res.ok) {
                    const data = await res.json();
                    serverSettings = data.settings || {};
                    
                    const localSettings = JSON.parse(localStorage.getItem('craneapp_settings') || '{}');
                    
                    // Мержим: сервер приоритетнее, но не затираем если сервер вернул пустое
                    const mergedSettings = { ...localSettings };
                    if (serverSettings.theme) mergedSettings.theme = serverSettings.theme;
                    if (serverSettings.accentColor) mergedSettings.accentColor = serverSettings.accentColor;
                    if (serverSettings.fontSize) mergedSettings.fontSize = serverSettings.fontSize;
                    if (serverSettings.language) mergedSettings.language = serverSettings.language;
                    if (serverSettings.notifications !== undefined) mergedSettings.notifications = serverSettings.notifications;
                    if (serverSettings.sounds !== undefined) mergedSettings.sounds = serverSettings.sounds;
                    
                    localStorage.setItem('craneapp_settings', JSON.stringify(mergedSettings));
                    if (mergedSettings.language) {
                        localStorage.setItem('craneapp_language', mergedSettings.language);
                        if (window.i18n?.setLanguage && window.i18n.currentLang !== mergedSettings.language) {
                            window.i18n.setLanguage(mergedSettings.language);
                        }
                    }
                    
                    updateThemeDisplay(mergedSettings.theme || 'dark');
                    updateLanguageDisplay(mergedSettings.language || 'ru');
                    updateToggles(mergedSettings);
                    
                    if (window.applyTheme) window.applyTheme();
                    
                    updateSyncIndicator('synced');
                }
            } catch (e) {
                // Если сервер недоступен — читаем из localStorage
                const localSettings = JSON.parse(localStorage.getItem('craneapp_settings') || '{}');
                updateThemeDisplay(localSettings.theme || 'dark');
                updateLanguageDisplay(localSettings.language || localStorage.getItem('craneapp_language') || 'ru');
                updateToggles(localSettings);
                updateSyncIndicator('error');
            }
        }

        async function saveSettingsToServer(settings) {
            try {
                await fetch('/api/v1/users/settings', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify(settings)
                });
                
                console.log('✅ Settings saved to server');
            } catch (e) {
                console.warn('⚠️ Failed to save settings:', e);
            }
        }

        function updateSyncIndicator(status) {
            const indicator = document.getElementById('syncIndicator');
            const icon = document.getElementById('syncIcon');
            const text = document.getElementById('syncText');
            
            switch (status) {
                case 'syncing':
                    indicator.className = 'sync-indicator syncing';
                    icon.textContent = '🔄';
                    text.textContent = window.i18n?.t('syncing') || 'Синхронизация...';
                    break;
                case 'synced':
                    indicator.className = 'sync-indicator synced';
                    icon.textContent = '✓';
                    text.textContent = window.i18n?.t('synchronized') || 'Синхронизировано';
                    setTimeout(function() {
                        indicator.style.opacity = '0.5';
                    }, 2000);
                    break;
                case 'error':
                    indicator.className = 'sync-indicator';
                    indicator.style.color = '#FF4B4B';
                    icon.textContent = '⚠';
                    text.textContent = window.i18n?.t('syncError') || 'Ошибка синхронизации';
                    break;
            }
        }

        async function syncNow() {
            document.getElementById('pcDropdown').classList.remove('show');
            updateSyncIndicator('syncing');
            await Promise.all([syncUserData(), syncSettings()]);
        }

        // ============================================
        // PROFILE DISPLAY
        // ============================================
        const BADGE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-left:4px;flex-shrink:0"><circle cx="8" cy="8" r="8" fill="url(#sg)"/><path d="M4.5 8L7 10.5L11.5 5.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="sg" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse"><stop stop-color="#FF007F"/><stop offset="1" stop-color="#9D00FF"/></linearGradient></defs></svg>';

        function renderSettingsBadges(badges, isPremium) {
            let html = '';
            const list = Array.isArray(badges) ? [...badges] : [];
            if (isPremium && !list.includes('premium')) list.push('premium');
            const defs = {
                developer: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-left:3px"><circle cx="8" cy="8" r="8" fill="url(#sd1)"/><path d="M4.5 8L7 10.5L11.5 5.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="sd1" x1="0" y1="0" x2="16" y2="16"><stop stop-color="#FF007F"/><stop offset="1" stop-color="#9D00FF"/></linearGradient></defs></svg>',
                verified:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-left:3px"><circle cx="8" cy="8" r="8" fill="url(#sd2)"/><path d="M4.5 8L7 10.5L11.5 5.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="sd2" x1="0" y1="0" x2="16" y2="16"><stop stop-color="#FF007F"/><stop offset="1" stop-color="#9D00FF"/></linearGradient></defs></svg>',
                admin:     '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-left:3px"><circle cx="8" cy="8" r="8" fill="url(#sd3)"/><path d="M4.5 8L7 10.5L11.5 5.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="sd3" x1="0" y1="0" x2="16" y2="16"><stop stop-color="#0088FF"/><stop offset="1" stop-color="#00C8C8"/></linearGradient></defs></svg>',
                premium:   '<span style="display:inline-block;vertical-align:middle;margin-left:3px;font-size:14px;filter:drop-shadow(0 0 3px #FFD700)">⭐</span>',
            };
            for (const b of list) { if (defs[b]) html += defs[b]; }
            return html;
        }

        function updateProfileDisplay() {
            const nameEl = document.getElementById('profileName');
            const usernameEl = document.getElementById('profileUsername');
            const bioEl = document.getElementById('profileBio');
            const accountEl = document.getElementById('accountUsername');
            const avatarEl = document.getElementById('profileAvatar');

            const badgeHtml = renderSettingsBadges(user.badges || [], user.isPremium);
            const safeFirstName = (user.firstName || '').replace(/[&<>]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; });
            nameEl.innerHTML = (safeFirstName || window.i18n?.t('user') || 'Пользователь') + badgeHtml;
            usernameEl.textContent = user.username ? '@' + user.username : '@username';
            accountEl.textContent = user.username ? '@' + user.username : '';
            bioEl.textContent = user.bio || '';
            
            if (user.avatarUrl) {
                if (user.avatarUrl.startsWith('data:image') || user.avatarUrl.startsWith('http') || user.avatarUrl.startsWith('/')) {
                    avatarEl.innerHTML = '<img src="' + user.avatarUrl + '" class="profile-avatar-img" alt="">';
                } else if (user.avatarUrl.length <= 10) {
                    avatarEl.innerHTML = '<span class="profile-avatar-placeholder">' + user.avatarUrl + '</span>';
                } else {
                    avatarEl.innerHTML = '<span class="profile-avatar-placeholder">' + (user.firstName || '👤')[0].toUpperCase() + '</span>';
                }
            } else {
                avatarEl.innerHTML = '<span class="profile-avatar-placeholder">' + (user.firstName || '👤')[0].toUpperCase() + '</span>';
            }
        }

        // ============================================
        // THEME & SETTINGS DISPLAY
        // ============================================
        function updateThemeDisplay(theme) {
            const themeNames = { dark: 'dark', light: 'light', auto: 'auto' };
            document.getElementById('themeValue').textContent = window.i18n?.t(themeNames[theme] || 'dark') || 'Тёмная';
        }
        
        function updateLanguageDisplay(language) {
            document.getElementById('languageValue').textContent = window.i18n?.languageNames?.[language] || 'Русский';
        }

        function updateToggles(settings) {
            const notifToggle = document.getElementById('toggleChatNotif');
            const soundsToggle = document.getElementById('toggleSounds');

            if (notifToggle) {
                if (settings.notifications) notifToggle.classList.add('active');
                else notifToggle.classList.remove('active');
            }

            if (soundsToggle) {
                if (settings.sounds) soundsToggle.classList.add('active');
                else soundsToggle.classList.remove('active');
            }
        }
        async function toggleSetting(element, settingName) {
            element.classList.toggle('active');
            const isActive = element.classList.contains('active');
            
            const settings = JSON.parse(localStorage.getItem('craneapp_settings') || '{}');
            settings[settingName] = isActive;
            localStorage.setItem('craneapp_settings', JSON.stringify(settings));
            
            await saveSettingsToServer(settings);
            showToast('success', isActive ? (window.i18n?.t('enabledToast') || 'Включено') : (window.i18n?.t('disabledToast') || 'Выключено'), '✓');
        }

        // ============================================
        // MENU & NAVIGATION
        // ============================================
        const pcMenuBtn = document.getElementById('pcMenuBtn');
        const pcDropdown = document.getElementById('pcDropdown');
        
        pcMenuBtn.onclick = function(e) { 
            e.stopPropagation(); 
            pcDropdown.classList.toggle('show'); 
        };
        
        document.addEventListener('click', function() { 
            pcDropdown.classList.remove('show'); 
        });

        function goToChats() {
            window.location.href = '../chats/chats.html';
        }

        // ============================================
        // LOGOUT
        // ============================================
        function doLogout() {
            if (confirm(window.i18n?.t('sureLogout') || 'Вы уверены, что хотите выйти?')) {
                localStorage.removeItem('craneapp_auth_token');
                localStorage.removeItem('craneapp_user_data');
                showToast('success', window.i18n?.t('logoutDone') || 'Выход выполнен', '✓');
                setTimeout(function() {
                    window.location.href = '../auth/login.html';
                }, 500);
            }
        }
        
        document.getElementById('logoutBtnMobile').onclick = doLogout;
        document.getElementById('pcLogoutBtn').onclick = doLogout;

        // ============================================
        // TAB BAR
        // ============================================
        const tabBar = document.getElementById('tabBar');
        const tabs = [
            { icon: '👥', labelKey: 'contacts', label: 'Контакты', page: '../contacts/contacts.html' },
            { icon: '📞', labelKey: 'calls', label: 'Звонки', page: '../calls/calls.html' },
            { icon: '💬', labelKey: 'chats', label: 'Чаты', page: '../chats/chats.html' },
            { icon: '⚙', labelKey: 'settings', label: 'Настройки', page: './settings.html', active: true }
        ];
        
        tabs.forEach(function(t) {
            const div = document.createElement('div');
            div.className = 'tab-item' + (t.active ? ' active' : '');
            div.innerHTML = '<span class="tab-icon">' + t.icon + '</span><span class="tab-label" data-i18n="' + t.labelKey + '">' + (window.i18n?.t(t.labelKey) || t.label) + '</span>';
            div.onclick = function() { if (!t.active) window.location.href = t.page; };
            tabBar.appendChild(div);
        });

        // ============================================
        // TOAST
        // ============================================
        function showToast(type, message, icon) {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.innerHTML = '<span>' + icon + '</span><span>' + message + '</span>';
            container.appendChild(toast);
            setTimeout(function() {
                toast.style.opacity = '0';
                setTimeout(function() { toast.remove(); }, 300);
            }, 3000);
        }

        // ============================================
        // PAGE EVENTS
        // ============================================
        window.addEventListener('pageshow', function(event) {
            user = JSON.parse(localStorage.getItem('craneapp_user_data') || '{}');
            updateProfileDisplay();
            syncUserData();
            syncSettings();
        });

        // ============================================
        // INIT - АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ
        // ============================================
        updateProfileDisplay();
        syncUserData();
        syncSettings();
        
        // Применяем переводы после загрузки i18n
        setTimeout(() => {
            if (window.i18n) {
                window.i18n.translatePage();
            }
        }, 100);

        window.addEventListener('craneapp:languagechange', function() {
            const localSettings = JSON.parse(localStorage.getItem('craneapp_settings') || '{}');
            updateThemeDisplay(localSettings.theme || 'dark');
            updateLanguageDisplay(localSettings.language || localStorage.getItem('craneapp_language') || 'ru');
            updateSyncIndicator('synced');
        });

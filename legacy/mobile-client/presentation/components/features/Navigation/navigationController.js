(function() {
    function createNavigationController(options) {
        const tr = options.tr || function(key, fallback) { return fallback || key; };
        const escapeHtml = options.escapeHtml || function(value) { return value || ''; };

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

    const callController = window.CraneCallPanelController.create({
        getActiveChat: () => activeChat,
        getChatUsers: () => chatUsers,
        getUser: () => user,
        showToast: (...args) => showToast(...args),
        tr,
    });
    function _showCallPanel() { return callController.showCallPanel(); }
    function _hideCallPanel() { return callController.hideCallPanel(); }
    function _endCall(fromBar) { return callController.endCall(fromBar); }
    function startVideoCallFromChat() { return callController.startVideoCallFromChat(); }
    function startAudioCallFromChat() { return callController.startAudioCallFromChat(); }
    function acceptIncomingCall() { return callController.acceptIncomingCall(); }
    function rejectIncomingCall() { return callController.rejectIncomingCall(); }
    function startInstantMeeting() { return callController.startInstantMeeting(); }
    function joinMeetingByLink() { return callController.joinMeetingByLink(); }

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
                '<div style="width:72px;height:72px;border-radius:20px;background:var(--rd-bg-elev,rgba(28,28,32,0.72));border:1px solid var(--rd-stroke,rgba(255,255,255,0.08));display:flex;align-items:center;justify-content:center;margin-bottom:16px;">' + icon + '</div>' +
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

        const dmIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
        const groupIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
        const channelIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8v18l-18-8z"/></svg>';
        const commIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18z"/></svg>';
        const meetIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';

        if (section === 'channels') {
            showPlaceholder(channelIcon, tr('channels', 'Каналы'), tr('channelsSectionDesc', 'Раздел в разработке. Скоро вы сможете создавать каналы и подписываться на них.'));
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
                if (section === 'dms') {
                    it.style.display = isPrivate ? '' : 'none';
                    if (isPrivate) visibleCount++;
                } else if (section === 'chats') {
                    it.style.display = isPrivate ? 'none' : '';
                    if (!isPrivate) visibleCount++;
                }
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

        return {
            closeAboutHub,
            closeSettingsHub,
            closeSideMenu,
            openAboutHub,
            openSettingsHub,
            openSideMenu,
            switchSection,
        };
    }

    window.CraneNavigationController = { create: createNavigationController };
})();

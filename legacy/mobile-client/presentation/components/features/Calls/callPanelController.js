(function() {
    function createCallPanelController(options) {
        const getActiveChat = options.getActiveChat || function() { return null; };
        const getChatUsers = options.getChatUsers || function() { return {}; };
        const getUser = options.getUser || function() { return {}; };
        const tr = options.tr || function(key, fallback) { return fallback || key; };
        const showToast = function() {
            if (typeof options.showToast === 'function') {
                return options.showToast.apply(null, arguments);
            }
        };

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

    function _openCallWindow(roomId, type, title, kind) {
        const url = '../calls/call.html?room=' + encodeURIComponent(roomId)
            + '&type=' + encodeURIComponent(type || 'group')
            + '&kind=' + encodeURIComponent(kind || 'video')
            + (title ? '&title=' + encodeURIComponent(title) : '')
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
        if (getActiveChat()) {
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
        if (getActiveChat()) {
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
        try {
            const token = localStorage.getItem('craneapp_auth_token');
            const res = await fetch('/api/v2/calls/rooms', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, chatId, title })
            });
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            return data.room.id;
        } catch (e) {
            // Фолбэк — клиентский ID, /calls/call.html сам создаст комнату
            return _genRoomId();
        }
    }

    async function _startCallFromChat(kind) {
        if (!getActiveChat()) { try { showToast && showToast('info','Выберите чат'); } catch(_){} return; }

        // Если уже идёт звонок — приглашаем собеседника присоединиться к нему
        if (_activeCallRoomId) {
            if (getActiveChat().type === 'group') {
                try { showToast && showToast('info', tr('groupAddUnsupported', 'Групповое добавление из меню чата пока не поддерживается')); } catch(_){}
                return;
            }
            const peerId = getChatUsers()[getActiveChat().id]?.id;
            if (!peerId || peerId === getUser().id) {
                try { showToast && showToast('info', tr('peerNotFound', 'Не удалось найти собеседника')); } catch(_){}
                return;
            }
            try {
                const ws = window.craneWs || window.ws;
                if (ws && ws.readyState === 1) {
                    ws.send(JSON.stringify({
                        type: 'call_invite', to: peerId, roomId: _activeCallRoomId,
                        callType: 'group', kind,
                        fromName: getUser().firstName || getUser().username, fromAvatar: getUser().avatarUrl || null,
                        title: _activeCallTitle
                    }));
                    try { showToast && showToast('success', tr('inviteSent', 'Приглашение отправлено')); } catch(_){}
                }
            } catch(_) {}
            _showCallPanel();
            return;
        }

        const _callBtn = document.getElementById(kind === 'audio' ? 'audioCallBtn' : 'videoCallBtn');
        const isGroup = getActiveChat().type === 'group';
        const kindLabel = kind === 'audio' ? tr('audioCall', 'Аудиозвонок') : tr('videoCall', 'Видеозвонок');
        const title = getActiveChat().name || (isGroup ? tr('groupCall', 'Групповой звонок') : kindLabel);
        const roomId = await _createCallRoom(isGroup ? 'group' : 'p2p', getActiveChat().id, title);
        try {
            const ws = window.craneWs || window.ws;
            if (ws && ws.readyState === 1) {
                // Для личного чата берём ID собеседника из getChatUsers()
                let targets = [];
                if (!isGroup) {
                    const peerId = getChatUsers()[getActiveChat().id]?.id;
                    if (peerId && peerId !== getUser().id) targets = [peerId];
                } else {
                    // Для группы — запрашиваем участников через API
                    try {
                        const token = localStorage.getItem('craneapp_auth_token');
                        const r = await fetch('/api/v2/chats/' + getActiveChat().id + '/members', {
                            headers: { 'Authorization': 'Bearer ' + token }
                        });
                        if (r.ok) {
                            const d = await r.json();
                            targets = (d.members || []).map(m => m.id || m.userId).filter(id => id && id !== getUser().id);
                        }
                    } catch(_) {}
                }
                if (targets.length === 0) {
                    try { showToast('Не удалось найти собеседника'); } catch(_){}
                }
                const invitePayloads = targets.map(to => ({
                    type: 'call_invite', to, roomId,
                    kind, fromName: getUser().firstName || getUser().username, fromAvatar: getUser().avatarUrl || null,
                    title
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
        _openCallWindow(roomId, isGroup ? 'group' : 'p2p', title, kind);
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
        kindIcon.innerHTML = isAudio
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
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
        const callType = c.callType || 'p2p';
        _openCallWindow(c.roomId, callType, c.title || c.fromName || (kind === 'audio' ? tr('audioCall', 'Аудиозвонок') : tr('videoCall', 'Видеозвонок')), kind);
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
        const title = 'Встреча — ' + (getUser().firstName || getUser().username || 'CraneApp');
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

        function handleCallCancelled(roomId) {
            if (_incomingCall && _incomingCall.roomId === roomId) {
                try { _stopRingtone(); } catch(_) {}
                _hideIncomingCallBanner();
                _incomingCall = null;
            }
        }

        return {
            acceptIncomingCall,
            endCall: _endCall,
            handleCallCancelled,
            hideCallPanel: _hideCallPanel,
            joinMeetingByLink,
            rejectIncomingCall,
            showCallPanel: _showCallPanel,
            startAudioCallFromChat,
            startInstantMeeting,
            startVideoCallFromChat,
        };
    }

    window.CraneCallPanelController = { create: createCallPanelController };
})();

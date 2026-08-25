(function(){try{var s=JSON.parse(localStorage.getItem('craneapp_settings')||'{}');if(s.accentColor){document.documentElement.style.setProperty('--accent',s.accentColor);document.documentElement.style.setProperty('--accent-2',s.accentColor);}}catch(_){}})();

(function(){
    'use strict';

    // ---------- Утилиты ----------
    const qs = new URLSearchParams(location.search);
    const ROOM_ID = qs.get('room') || '';
    const ROOM_TITLE = qs.get('title') || '';
    const ROOM_TYPE = qs.get('type') || 'group';
    const ROOM_KIND = (qs.get('kind') === 'audio') ? 'audio' : 'video'; // audio | video
    const CHAT_ID = qs.get('chatId') || '';
    const API_BASE_URL = (qs.get('apiBase') || `${location.origin}/api/v2`).replace(/\/+$/, '');
    const SOCKET_URL = qs.get('socketUrl') || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
    const IS_GROUP_CHAT_CALL = !!CHAT_ID || (ROOM_ID && ROOM_ID.startsWith('grp_'));
    const IS_EMBEDDED = qs.get('embedded') === '1';
    if (IS_EMBEDDED) document.body.classList.add('embedded');

    function minimizeCall(){
        if (IS_EMBEDDED) window.parent.postMessage({ type: 'crane_call_minimize' }, '*');
    }
    document.getElementById('ctrlBack').onclick = minimizeCall;

    // Сигнал от родительского окна — завершить звонок
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'crane_hangup') leaveCall(true);
    });
    const IS_AUDIO = ROOM_KIND === 'audio';
    const IS_P2P = ROOM_TYPE === 'p2p';
    const TOKEN = localStorage.getItem('craneapp_auth_token');
    let userData;
    try { userData = JSON.parse(localStorage.getItem('craneapp_user_data') || '{}'); } catch(_) { userData = {}; }
    const tr = (key, fallback, vars) => {
        const value = window.i18n?.t(key, vars);
        if (value && value !== key) return value;
        return window.i18n?.translations?.en?.[key] || fallback;
    };
    const ME = { id: userData.id || ('guest_'+Math.random().toString(36).slice(2,7)), name: userData.firstName || userData.username || tr('guest', 'Гость'), avatar: userData.avatarUrl || null };

    let localStream = null;

    function apiUrl(path){
        return API_BASE_URL + '/' + String(path || '').replace(/^\/+/, '');
    }

    function socketUrlWithToken(){
        const url = new URL(SOCKET_URL, location.href);
        url.searchParams.set('token', TOKEN);
        return url.toString();
    }

    function exitLobby(){
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }
        if (IS_EMBEDDED) {
            window.parent.postMessage({ type: 'crane_call_ended' }, '*');
            return;
        }
        if (window.opener && !window.opener.closed) {
            try { window.close(); return; } catch(_) {}
        }
        location.href = '/chats';
    }

    if (!TOKEN || !userData.id) {
        location.href = '/login';
        return;
    }
    if (!ROOM_ID) {
        document.getElementById('lobbyTitle').textContent = tr('roomMissing', 'Комната не указана');
        document.getElementById('lobbySub').textContent = tr('openCallInvite', 'Откройте звонок по приглашению');
        document.getElementById('lobbyJoinBtn').disabled = true;
        const lobbyInviteEarly = document.getElementById('lobbyInvite');
        if (lobbyInviteEarly) lobbyInviteEarly.classList.add('is-disabled');
        document.getElementById('lobbyLeaveBtn').onclick = exitLobby;
        return;
    }

    // Применяем режим к UI
    if (IS_AUDIO) {
        document.getElementById('lobbyTitle').textContent = ROOM_TITLE || tr('audioCall', 'Аудиозвонок');
        document.getElementById('lobbySub').textContent = tr('cameraDefaultOff', 'Камера по умолчанию выключена — можно включить');
    }
    if (IS_P2P) {
        document.body.classList.add('pip-mode');
    }

    function buildInviteLink(){
        const params = new URLSearchParams();
        params.set('room', ROOM_ID);
        params.set('type', ROOM_TYPE || 'group');
        params.set('kind', ROOM_KIND);
        if (ROOM_TITLE) params.set('title', ROOM_TITLE);
        return location.origin + location.pathname + '?' + params.toString();
    }

    async function copyText(text){
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch(_) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return ok;
            } catch(__) { return false; }
        }
    }

    async function copyInviteLink(){
        if (!ROOM_ID) return;
        const url = buildInviteLink();
        const ok = await copyText(url);
        if (!ok) {
            showToast(tr('copyError', 'Ошибка копирования'));
            return;
        }
        showToast(tr('linkCopied', 'Ссылка скопирована'));
        const btn = document.getElementById('lobbyCopyBtn');
        if (!btn) return;
        btn.classList.add('copied');
        const span = btn.querySelector('span');
        const orig = span ? span.textContent : '';
        if (span) span.textContent = tr('copied', 'Скопировано');
        clearTimeout(copyInviteLink._t);
        copyInviteLink._t = setTimeout(() => {
            btn.classList.remove('copied');
            if (span && orig) span.textContent = orig;
        }, 2000);
    }

    const lobbyInvite = document.getElementById('lobbyInvite');
    const lobbyInviteUrl = document.getElementById('lobbyInviteUrl');
    if (IS_GROUP_CHAT_CALL && lobbyInvite) {
        lobbyInvite.style.display = 'none';
    } else {
        if (lobbyInviteUrl) lobbyInviteUrl.value = ROOM_ID ? buildInviteLink() : '';
        document.getElementById('lobbyCopyBtn').onclick = copyInviteLink;
        lobbyInviteUrl && (lobbyInviteUrl.onclick = () => { lobbyInviteUrl.select(); lobbyInviteUrl.setSelectionRange(0, lobbyInviteUrl.value.length); });
    }
    document.getElementById('lobbyLeaveBtn').onclick = exitLobby;
    document.getElementById('callTitle').textContent = ROOM_TITLE || (IS_AUDIO
        ? tr('audioCall', 'Аудиозвонок')
        : (IS_P2P ? tr('videoCall', 'Видеозвонок') : tr('videoMeeting', 'Видеовстреча')));

    function showToast(text, ms=2200){
        const t = document.getElementById('toast');
        t.textContent = text;
        t.classList.add('show');
        clearTimeout(showToast._t);
        showToast._t = setTimeout(()=>t.classList.remove('show'), ms);
    }

    // ---------- Состояние ----------
    let screenStream = null;
    let micEnabled = true;
    let camEnabled = !IS_AUDIO; // в audio-mode камера отключена
    let speakerOn = true;
    let ws = null;
    let wsReady = false;
    let iceServers = [{ urls:'stun:stun.l.google.com:19302' }];
    const peers = new Map();
    let callStartTs = 0;
    let timerInterval = null;
    let connected = false; // первый peer подключился (для audio-режима)
    let dialingTimer = null;
    let inCall = false;
    let wsKeepaliveTimer = null;
    let isLeaving = false;
    let wsReconnectTimer = null;
    let ringbackCtx = null;
    let ringbackGain = null;
    let callVolume = 100;

    function startRingback(){
        if (ringbackCtx) return;
        try {
            ringbackCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = ringbackCtx;
            ringbackGain = ctx.createGain();
            ringbackGain.gain.value = callVolume / 100;
            ringbackGain.connect(ctx.destination);
            const RING = 1.5, GAP = 3.0, CYCLES = 25;
            for (let i = 0; i < CYCLES; i++){
                const t = ctx.currentTime + i * (RING + GAP);
                const o1 = ctx.createOscillator();
                const o2 = ctx.createOscillator();
                const gain = ctx.createGain();
                o1.frequency.value = 440;
                o2.frequency.value = 480;
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.07, t + 0.04);
                gain.gain.setValueAtTime(0.07, t + RING - 0.04);
                gain.gain.linearRampToValueAtTime(0, t + RING);
                o1.connect(gain); o2.connect(gain); gain.connect(ringbackGain);
                o1.start(t); o2.start(t);
                o1.stop(t + RING); o2.stop(t + RING);
            }
        } catch(_) {}
    }

    function stopRingback(){
        if (ringbackCtx){ try { ringbackCtx.close(); } catch(_) {} ringbackCtx = null; }
        ringbackGain = null;
    }

    // ---------- Лобби: предпросмотр камеры ----------
    const lobbyVideo = document.getElementById('lobbyVideo');
    const lobbyEmpty = document.getElementById('lobbyPreviewEmpty');
    const lobbyMicBtn = document.getElementById('lobbyMicBtn');
    const lobbyCamBtn = document.getElementById('lobbyCamBtn');

    async function startLocalStream(){
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
            });
            localStream = s;
            applyTrackStates();
            lobbyVideo.srcObject = s;
            lobbyEmpty.style.display = camEnabled ? 'none' : 'flex';
        } catch(err) {
            console.warn('getUserMedia error', err);
            try {
                const s = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true }, video: false });
                localStream = s;
                camEnabled = false;
                applyTrackStates();
                lobbyEmpty.style.display = 'flex';
                lobbyEmpty.querySelector('span').textContent = tr('cameraUnavailable', 'Камера недоступна');
            } catch(e2) {
                showToast(tr('noCameraMicAccess', 'Нет доступа к камере и микрофону'));
                lobbyEmpty.querySelector('span').textContent = tr('mediaAccessDenied', 'Доступ запрещён');
            }
        }
    }

    function applyTrackStates(){
        if (!localStream) return;
        localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
        localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
        lobbyMicBtn.classList.toggle('off', !micEnabled);
        lobbyCamBtn.classList.toggle('off', !camEnabled);
        const ctrlMicEl = document.getElementById('ctrlMic');
        const ctrlCamEl = document.getElementById('ctrlCam');
        if (ctrlMicEl) ctrlMicEl.classList.toggle('off', !micEnabled);
        if (ctrlCamEl) ctrlCamEl.classList.toggle('off', !camEnabled);
        // Обновляем превью лобби и заглушку своего тайла
        if (!camEnabled) lobbyEmpty.style.display = 'flex';
        else if (localStream.getVideoTracks().length) lobbyEmpty.style.display = 'none';
        const selfPh = document.querySelector('.tile.is-self .ph');
        if (selfPh) selfPh.style.display = (camEnabled && localStream && localStream.getVideoTracks().some(t => t.readyState !== 'ended')) ? 'none' : '';
    }

    lobbyMicBtn.onclick = () => { micEnabled = !micEnabled; applyTrackStates(); broadcastState(); };
    lobbyCamBtn.onclick = () => { camEnabled = !camEnabled; applyTrackStates(); broadcastState(); };

    document.getElementById('ctrlMic').onclick = lobbyMicBtn.onclick;
    document.getElementById('ctrlCam').onclick = lobbyCamBtn.onclick;

    // ---------- Запросить ICE-серверы и метаданные комнаты ----------
    async function fetchRoomConfig(){
        try {
            const res = await fetch(apiUrl('/calls/rooms/' + encodeURIComponent(ROOM_ID)), {
                headers: { 'Authorization': 'Bearer ' + TOKEN }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.iceServers) iceServers = data.iceServers;
                if (data.room && data.room.title) document.getElementById('callTitle').textContent = data.room.title;
            } else if (res.status === 404) {
                // Комнаты ещё нет — создадим и возьмём ICE-серверы из ответа
                const cr = await fetch(apiUrl('/calls/rooms'), {
                    method:'POST',
                    headers:{ 'Authorization':'Bearer '+TOKEN, 'Content-Type':'application/json' },
                    body: JSON.stringify({
                        type: ROOM_TYPE,
                        callKind: ROOM_KIND,
                        title: ROOM_TITLE,
                        chatId: CHAT_ID || null
                    })
                });
                if (cr.ok) {
                    const cd = await cr.json();
                    if (cd.iceServers && cd.iceServers.length) iceServers = cd.iceServers;
                }
            }
        } catch(_) {}
    }

    // ---------- Добавить участника ----------
    document.getElementById('ctrlAddPeer').onclick = () => {
        if (IS_EMBEDDED) {
            window.parent.postMessage({ type: 'crane_add_peer' }, '*');
        } else {
            showToast(tr('openChatCallHint', 'Откройте чат и нажмите кнопку звонка'));
        }
    };

    // ---------- Hangup ----------
    document.getElementById('ctrlHangup').onclick = () => leaveCall(true);

    // ---------- Громкость звонка ----------
    const volumeControlEl = document.getElementById('callVolumeControl');
    const callVolumeBtn = document.getElementById('ctrlVolume');
    const callVolumeSlider = document.getElementById('callVolumeSlider');
    const callVolumeValue = document.getElementById('callVolumeValue');
    if (callVolumeBtn && callVolumeSlider && volumeControlEl) {
        setCallVolume(callVolume, false);
        callVolumeBtn.onclick = (e) => {
            e.stopPropagation();
            volumeControlEl.classList.toggle('open');
        };
        callVolumeSlider.oninput = () => setCallVolume(callVolumeSlider.value);
        callVolumeSlider.onclick = (e) => e.stopPropagation();
        document.addEventListener('pointerdown', (e) => {
            if (!volumeControlEl.contains(e.target)) volumeControlEl.classList.remove('open');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') volumeControlEl.classList.remove('open');
        });
    }

    function clampVolume(value){
        const n = Number(value);
        if (!Number.isFinite(n)) return 100;
        return Math.max(0, Math.min(100, Math.round(n)));
    }

    function setCallVolume(value){
        callVolume = clampVolume(value);
        const normalized = callVolume / 100;
        if (callVolumeSlider) callVolumeSlider.value = String(callVolume);
        if (callVolumeValue) callVolumeValue.textContent = callVolume + '%';
        if (callVolumeBtn) callVolumeBtn.classList.toggle('off', callVolume === 0);
        for (const peer of peers.values()) {
            applyCallVolumeToMedia(peer.videoEl);
            applyCallVolumeToMedia(peer.audioEl);
        }
        if (ringbackGain && ringbackCtx) {
            try { ringbackGain.gain.setTargetAtTime(normalized, ringbackCtx.currentTime, 0.02); } catch(_) {}
        }
    }

    function applyCallVolumeToMedia(el){
        if (!el) return;
        try {
            el.volume = callVolume / 100;
            el.muted = callVolume === 0;
        } catch(_) {}
    }

    // ---------- Демонстрация экрана ----------
    const ctrlScreen = document.getElementById('ctrlScreen');
    if (ctrlScreen) ctrlScreen.onclick = async () => {
        try {
            if (!screenStream) {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                screenTrack.onended = () => stopScreenShare();
                replaceVideoTrackForAll(screenTrack);
                showToast(tr('screenShareOn', 'Демонстрация экрана включена'));
                ctrlScreen.style.background = 'rgba(155,130,255,0.32)';
            } else {
                stopScreenShare();
            }
        } catch(e) { showToast(tr('screenShareError', 'Не удалось начать показ экрана')); }
    };
    function stopScreenShare(){
        if (screenStream) { screenStream.getTracks().forEach(t=>t.stop()); screenStream = null; }
        const camTrack = localStream && localStream.getVideoTracks()[0];
        if (camTrack) replaceVideoTrackForAll(camTrack);
        if (ctrlScreen) ctrlScreen.style.background = '';
    }
    function replaceVideoTrackForAll(newTrack){
        for (const p of peers.values()) {
            const senders = p.pc.getSenders().filter(s => s.track && s.track.kind === 'video');
            for (const s of senders) s.replaceTrack(newTrack);
        }
        // Обновим самопросмотр
        const selfTile = document.querySelector('.tile.is-self video');
        if (selfTile) {
            const ms = new MediaStream();
            ms.addTrack(newTrack);
            if (localStream) localStream.getAudioTracks().forEach(t=>ms.addTrack(t));
            selfTile.srcObject = ms;
        }
    }

    // ---------- WebSocket-сигналинг ----------
    function connectWS(){
        return new Promise((resolve)=>{
            ws = new WebSocket(socketUrlWithToken());
            ws.onopen = () => {
                wsReady = true;
                clearInterval(wsKeepaliveTimer);
                wsKeepaliveTimer = setInterval(() => wsSend({ type:'ping' }), 25000);
                resolve();
                // При реконнекте во время звонка — пересоздаём peers и переподключаемся
                if (inCall) {
                    _clearAllPeers();
                    wsSend({ type:'call_join', roomId:ROOM_ID, displayName:ME.name, avatarUrl:ME.avatar });
                }
            };
            ws.onmessage = (e) => handleWS(JSON.parse(e.data));
            ws.onclose = () => {
                wsReady = false;
                if (inCall) {
                    clearTimeout(wsReconnectTimer);
                    wsReconnectTimer = setTimeout(() => connectWS(), 1500);
                }
            };
            ws.onerror = () => {};
        });
    }
    function wsSend(obj){ if (ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }

    function _clearAllPeers(){
        for (const [, peer] of peers) {
            if (peer.pc) { try { peer.pc.close(); } catch(_) {} }
            if (peer.tileEl && peer.tileEl.parentNode) peer.tileEl.parentNode.removeChild(peer.tileEl);
            if (peer.audioEl) { try { peer.audioEl.srcObject = null; peer.audioEl.remove(); } catch(_) {} }
        }
        peers.clear();
        refreshTilesCount();
    }

    async function handleWS(msg){
        switch(msg.type){
            case 'ping':
                wsSend({ type:'pong' });
                break;
            case 'call_joined':
                // Создать pc и offer для каждого существующего peer-а
                for (const peer of (msg.peers||[])) {
                    await initiatePeer(peer);
                }
                break;
            case 'call_peer_joined':
                addPeerPlaceholder(msg.peer);
                // Не инициируем offer — ждём, пока новый peer пришлёт нам offer
                break;
            case 'call_peer_left':
                if (IS_P2P) {
                    removePeer(msg.peer.userId);
                    showToast(tr('peerLeftCall', 'Собеседник покинул звонок'));
                    setTimeout(() => leaveCall(true), 350);
                } else {
                    removePeer(msg.peer.userId);
                }
                break;
            case 'call_cancelled':
                showToast(tr('callEnded', 'Звонок завершён'));
                setTimeout(() => leaveCall(true), 350);
                break;
            case 'call_offer':
                await onRemoteOffer(msg.from, msg.payload);
                break;
            case 'call_answer':
                await onRemoteAnswer(msg.from, msg.payload);
                break;
            case 'call_ice':
                await onRemoteIce(msg.from, msg.payload);
                break;
            case 'call_error':
        showToast(msg.reason === 'room_full' ? (window.i18n?.t('roomFull') || 'Комната заполнена (макс. 5)') : (window.i18n?.t('callError') || 'Ошибка звонка'));
                setTimeout(()=>leaveCall(false), 1200);
                break;
        }
    }

    // ---------- PeerConnections ----------
    function makePC(peerId){
        const pc = new RTCPeerConnection({ iceServers });
        pc.onicecandidate = (e) => {
            if (e.candidate) wsSend({ type:'call_ice', to:peerId, roomId:ROOM_ID, payload:e.candidate });
        };
        pc.ontrack = (e) => {
            const peer = peers.get(peerId);
            if (!peer || !peer.videoEl) return;
            const stream = e.streams[0];
            if (!stream) return;
            // Один videoEl на peer — играет и аудио, и видео
            if (peer.videoEl.srcObject !== stream) {
                peer.videoEl.srcObject = stream;
            }
            applyCallVolumeToMedia(peer.videoEl);
            // Убираем аватар-заглушку только когда получили видеотрек
            if (e.track.kind === 'video' && peer.tileEl) {
                const ph = peer.tileEl.querySelector('.ph');
                if (ph) ph.style.display = 'none';
            }
            if (!connected) {
                connected = true;
                clearTimeout(dialingTimer); dialingTimer = null;
                stopRingback();
                startTimer();
            }
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                removePeer(peerId);
            }
        };
        if (localStream) {
            for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
        }
        return pc;
    }

    async function initiatePeer(peerInfo){
        const pid = peerInfo.userId;
        if (peers.has(pid)) return;
        addPeerPlaceholder(peerInfo);
        const peer = peers.get(pid);
        peer.pc = makePC(pid);
        const offer = await peer.pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
        await peer.pc.setLocalDescription(offer);
        wsSend({ type:'call_offer', to:pid, roomId:ROOM_ID, payload: peer.pc.localDescription });
    }

    async function onRemoteOffer(from, sdp){
        if (peers.has(from)) {
            // Переконнект — закрываем старый PC и создаём новый
            const existing = peers.get(from);
            if (existing.pc) { try { existing.pc.close(); } catch(_) {} existing.pc = null; }
        } else {
            addPeerPlaceholder({ userId: from, displayName: null, avatarUrl: null });
        }
        const peer = peers.get(from);
        peer.pc = makePC(from);
        await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        wsSend({ type:'call_answer', to:from, roomId:ROOM_ID, payload: peer.pc.localDescription });
    }
    async function onRemoteAnswer(from, sdp){
        const peer = peers.get(from); if (!peer || !peer.pc) return;
        await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
    async function onRemoteIce(from, candidate){
        const peer = peers.get(from); if (!peer || !peer.pc) return;
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(_) {}
    }

    function broadcastState(){
        // (зарезервировано) — сейчас mute/cam отображается только локально
    }

    // ---------- Тайлы ----------
    const tilesEl = document.getElementById('tiles');
    function refreshTilesCount(){
        const n = Math.min(5, 1 + peers.size);
        tilesEl.dataset.count = String(n);
        document.getElementById('callPeerCount').textContent = String(n);
    }

    function addSelfTile(){
        const tile = document.createElement('div');
        tile.className = 'tile is-self';
        tile.dataset.userId = 'self';
        tile.innerHTML = `
            <video autoplay playsinline muted></video>
            <div class="ph"><div class="ph-avatar">${escapeHtml((ME.name||'?')[0].toUpperCase())}</div></div>
            <div class="label">
                <span class="name">${escapeHtml(ME.name)} (${tr('you', 'вы')})</span>
                <span class="mic-state" id="selfMicState"></span>
            </div>`;
        tilesEl.appendChild(tile);
        const v = tile.querySelector('video');
        if (localStream) v.srcObject = localStream;
        if (camEnabled && localStream && localStream.getVideoTracks().length) {
            tile.querySelector('.ph').style.display = 'none';
        }
    }

    function addPeerPlaceholder(info){
        const pid = info.userId;
        if (peers.has(pid)) return;
        const initial = ((info.displayName||'?')[0]||'?').toUpperCase();
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.dataset.userId = pid;
        tile.innerHTML = `
            <video autoplay playsinline></video>
            <div class="ph"><div class="ph-avatar">${info.avatarUrl?`<img src="${escapeAttr(info.avatarUrl)}" alt="">`:escapeHtml(initial)}</div></div>
            <div class="label">
                <span class="name">${escapeHtml(info.displayName || tr('participant', 'Участник'))}</span>
                <span class="mic-state"></span>
            </div>`;
        tilesEl.appendChild(tile);
        peers.set(pid, {
            pc:null,
            name: info.displayName || tr('participant', 'Участник'),
            avatar: info.avatarUrl||null,
            videoEl: tile.querySelector('video'),
            tileEl: tile
        });
        applyCallVolumeToMedia(peers.get(pid).videoEl);
        refreshTilesCount();
        // Если был режим 1-на-1 (pip), при появлении 3-го участника переходим в сетку
        if (IS_P2P && peers.size >= 2) {
            document.body.classList.remove('pip-mode');
        }
    }

    function removePeer(pid){
        const peer = peers.get(pid);
        if (!peer) return;
        try { peer.pc && peer.pc.close(); } catch(_) {}
        if (peer.tileEl && peer.tileEl.parentNode) peer.tileEl.parentNode.removeChild(peer.tileEl);
        if (peer.audioEl) {
            try { peer.audioEl.srcObject = null; peer.audioEl.remove(); } catch(_){}
        }
        peers.delete(pid);
        if (IS_P2P && peers.size === 0 && connected) {
            showToast(tr('peerLeftCall', 'Собеседник покинул звонок'));
            setTimeout(() => leaveCall(true), 1500);
            return;
        }
        refreshTilesCount();
    }

    function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function escapeAttr(s){ return escapeHtml(s); }

    // ---------- Таймер ----------
    function startTimer(){
        if (timerInterval) return;
        callStartTs = Date.now();
        const tick = () => {
            const sec = Math.floor((Date.now() - callStartTs) / 1000);
            const m = String(Math.floor(sec/60)).padStart(2,'0');
            const s = String(sec%60).padStart(2,'0');
            const txt = m+':'+s;
            const callTimeEl = document.getElementById('callTime');
            if (callTimeEl) callTimeEl.textContent = txt;
        };
        tick();
        timerInterval = setInterval(tick, 1000);
    }

    // ---------- Вход в комнату ----------
    async function joinCall(){
        if (!localStream) await startLocalStream();
        await fetchRoomConfig();
        inCall = true;
        await connectWS();
        wsSend({
            type:'call_join', roomId:ROOM_ID,
            displayName: ME.name, avatarUrl: ME.avatar,
            callKind: ROOM_KIND
        });
        document.getElementById('lobby').classList.add('hidden');
        document.getElementById('callView').style.display = 'flex';
        addSelfTile();
        if (IS_P2P) {
            const callTimeEl = document.getElementById('callTime');
            if (callTimeEl) callTimeEl.textContent = tr('dialing', 'Звоним...');
            startRingback();
            dialingTimer = setTimeout(() => {
                if (peers.size === 0) {
                    if (callTimeEl) callTimeEl.textContent = tr('noAnswer', 'Нет ответа');
                    setTimeout(() => leaveCall(true), 1500);
                }
            }, 60000);
        } else {
            startTimer();
        }
    }

    document.getElementById('lobbyJoinBtn').onclick = async () => {
        const btn = document.getElementById('lobbyJoinBtn');
        btn.disabled = true; btn.textContent = tr('connecting', 'Подключение...');
        await joinCall();
    };

    function leaveCall(returnHome){
        if (isLeaving) return;
        isLeaving = true;
        inCall = false;
        clearInterval(wsKeepaliveTimer); wsKeepaliveTimer = null;
        clearTimeout(wsReconnectTimer);
        stopRingback();
        try { wsSend({ type:'call_leave', roomId: ROOM_ID }); } catch(_) {}
        try { ws && ws.close(); } catch(_) {}
        for (const pid of Array.from(peers.keys())) removePeer(pid);
        if (localStream) localStream.getTracks().forEach(t=>t.stop());
        if (screenStream) screenStream.getTracks().forEach(t=>t.stop());
        clearInterval(timerInterval); timerInterval = null;
        clearTimeout(dialingTimer); dialingTimer = null;
        if (IS_EMBEDDED) {
            // В embedded-режиме сообщаем родителю — пусть он управляет навигацией
            window.parent.postMessage({ type: 'crane_call_ended' }, '*');
        } else if (returnHome) {
            // На десктопе — закрыть окно если оно было открыто; иначе вернуться в чаты
            if (window.opener && !window.opener.closed) { try { window.close(); return; } catch(_){} }
            location.href = '/chats';
        } else {
            document.getElementById('callView').style.display = 'none';
            document.getElementById('lobby').classList.remove('hidden');
            const btn = document.getElementById('lobbyJoinBtn');
            btn.disabled = false; btn.textContent = tr('join', 'Присоединиться');
            isLeaving = false;
        }
    }

    window.addEventListener('beforeunload', () => {
        try { wsSend({ type:'call_leave', roomId: ROOM_ID }); } catch(_) {}
    });

    // Старт: для одиночных звонков лобби пропускаем, сразу заходим
    if (IS_P2P) {
        document.getElementById('lobby').classList.add('hidden');
        joinCall();
    } else {
        startLocalStream();
    }

})();

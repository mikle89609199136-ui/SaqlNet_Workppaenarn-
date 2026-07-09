/**
 * Channel UI for CraneApp chats screen.
 * Loaded after chats_v5.js — uses shared globals (token, user, activeChat, allChats, etc.)
 */
(function() {
    'use strict';

    let channelAvatarBase64 = null;

    function tr(key, fallback, vars) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const v = window.i18n.t(key, vars);
            if (v && v !== key) return v;
        }
        return fallback;
    }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function isChannelPostUuid(id) {
        if (!id || typeof id !== 'string') return false;
        return !id.startsWith('temp-')
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    }

    function resolveChannelPostId(postId) {
        if (isChannelPostUuid(postId)) return postId;
        if (!postId) return null;
        const el = document.querySelector('[data-message-id="' + postId + '"]');
        if (el && isChannelPostUuid(el.dataset.messageId)) {
            return el.dataset.messageId;
        }
        return null;
    }

    window.openChannelCommentsFromPost = function(btn) {
        const postEl = btn && btn.closest('[data-message-id]');
        const postId = postEl ? postEl.dataset.messageId : null;
        if (!isChannelPostUuid(postId)) {
            if (typeof showToast === 'function') {
                showToast('info', tr('waitForPostPublish', 'Дождитесь публикации поста'), '⏳');
            }
            return;
        }
        openChannelComments(postId);
    };

    function resolveAvatarUrl(url) {
        if (!url) return '';
        if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('/')) return url;
        return '/' + url.replace(/^\/+/, '');
    }

    window.chIcon = function chIcon(name, size) {
        const s = size || 16;
        const icons = {
            eye: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
            comment: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
            settings: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
            clock: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            chevron: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
            chevronRight: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
            send: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
            megaphone: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a4 4 0 0 0 4 4h1"/><path d="M7 9V7a4 4 0 0 1 4-4h6l-4 8H7z"/><path d="M17 9v6"/></svg>',
            broadcast: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.75" fill="currentColor" stroke="none"/><path d="M9.5 9.5a4.5 4.5 0 0 0 0 5"/><path d="M14.5 9.5a4.5 4.5 0 0 1 0 5"/><path d="M7 7a8 8 0 0 0 0 10"/><path d="M17 7a8 8 0 0 1 0 10"/></svg>',
            close: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
            eyeOff: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-6.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
            quote: '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h4v10H5c0-3 2-5 2-7V7zm10 0h4v10h-6c0-3 2-5 2-7V7z"/></svg>'
        };
        return icons[name] || '';
    };

    window.formatCommentsCount = function(count) {
        const n = count || 0;
        const mod10 = n % 10;
        const mod100 = n % 100;
        let word = tr('commentsLower', 'комментариев');
        if (mod100 < 11 || mod100 > 14) {
            if (mod10 === 1) word = tr('commentOne', 'комментарий');
            else if (mod10 >= 2 && mod10 <= 4) word = tr('commentsFew', 'комментария');
        }
        return n + ' ' + word;
    };

    function buildCommentAvatarsHtml(commenters) {
        const list = Array.isArray(commenters) ? commenters.slice(0, 3) : [];
        if (!list.length) {
            return '<span class="channel-post-comment-avatars channel-post-comment-avatars--empty" aria-hidden="true"></span>';
        }
        const items = list.map(function(c, i) {
            const name = c.senderFirstName || c.senderUsername || '?';
            const initial = escapeHtml(name.charAt(0).toUpperCase());
            const av = resolveAvatarUrl(c.senderAvatar);
            const content = av
                ? '<img src="' + escapeHtml(av) + '" alt="">'
                : initial;
            return '<span class="channel-post-comment-avatar" style="z-index:' + (3 - i) + '">' + content + '</span>';
        }).join('');
        return '<span class="channel-post-comment-avatars">' + items + '</span>';
    }

    window.buildChannelPostMetaHtml = function(views, timeText) {
        return '<span class="channel-post-views-inline">'
            + '<span class="channel-post-stat-icon" aria-hidden="true">' + chIcon('eye', 13) + '</span>'
            + '<span class="channel-post-views-count">' + (views || 0) + '</span>'
            + '</span>'
            + '<span class="channel-post-time-text">' + escapeHtml(timeText || '') + '</span>';
    };

    window.buildChannelPostFooter = function(comments, postId, commentPreview) {
        return '<button type="button" class="channel-post-comments-btn"'
            + (isChannelPostUuid(postId) ? '' : ' disabled')
            + ' onclick="event.stopPropagation();openChannelCommentsFromPost(this)">'
            + '<span class="channel-post-comments-left">'
            + buildCommentAvatarsHtml(commentPreview)
            + '<span class="channel-post-comments-label">' + escapeHtml(formatCommentsCount(comments || 0)) + '</span>'
            + '</span>'
            + '<span class="channel-post-comments-chevron" aria-hidden="true">' + chIcon('chevronRight', 18) + '</span>'
            + '</button>';
    };

    window.appendPostCommentPreview = function(postId, comment) {
        if (!postId || !comment) return;
        const store = typeof messagesData !== 'undefined' ? messagesData : null;
        if (!store || !store[postId]) return;
        const post = store[postId];
        if (!post.commentPreview) post.commentPreview = [];
        const senderId = comment.senderId;
        post.commentPreview = post.commentPreview.filter(function(c) { return c.senderId !== senderId; });
        post.commentPreview.unshift({
            senderId: senderId,
            senderFirstName: comment.senderFirstName,
            senderUsername: comment.senderUsername,
            senderAvatar: comment.senderAvatar
        });
        post.commentPreview = post.commentPreview.slice(0, 3);
        window.updatePostCommentCount(postId, post.commentCount, post.commentPreview);
    };

    window.cleanupChannelComposer = function() {
        const tools = document.getElementById('channelAdminTools');
        if (tools) tools.remove();
        const bar = document.getElementById('channelSubscriberBar');
        if (bar) bar.style.display = 'none';
        const msgInput = document.getElementById('msgInput');
        if (msgInput) {
            msgInput.setAttribute('data-placeholder', tr('messagePlaceholder', 'Сообщение...'));
        }
    };

    function getToken() {
        return localStorage.getItem('craneapp_auth_token');
    }

    window.openCreateChannelModal = function() {
        if (typeof closeCreateModal === 'function') closeCreateModal();
        channelAvatarBase64 = null;
        const modal = document.getElementById('createChannelModal');
        if (!modal) return;
        document.getElementById('channelTitleInput').value = '';
        document.getElementById('channelDescInput').value = '';
        document.getElementById('channelUsernameInput').value = '';
        document.getElementById('channelPublicToggle').checked = true;
        document.getElementById('channelAvatarPreview').innerHTML =
            '<span class="channel-icon-placeholder">' + chIcon('megaphone', 28) + '</span>';
        modal.classList.add('active');
    };

    window.closeCreateChannelModal = function() {
        const modal = document.getElementById('createChannelModal');
        if (modal) modal.classList.remove('active');
    };

    window.handleChannelAvatar = function(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            channelAvatarBase64 = e.target.result;
            document.getElementById('channelAvatarPreview').innerHTML =
                '<img src="' + e.target.result + '" alt="">';
        };
        reader.readAsDataURL(file);
    };

    window.submitCreateChannel = async function() {
        const title = document.getElementById('channelTitleInput').value.trim();
        if (!title) {
            if (typeof showToast === 'function') showToast('error', 'Введите название канала', '❌');
            return;
        }
        const isPublic = document.getElementById('channelPublicToggle').checked;
        const username = document.getElementById('channelUsernameInput').value.trim();
        const body = {
            title,
            description: document.getElementById('channelDescInput').value.trim(),
            isPublic,
            username: isPublic ? username : null
        };
        if (channelAvatarBase64) body.avatar = channelAvatarBase64;

        const btn = document.querySelector('#createChannelModal button[onclick="submitCreateChannel()"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Создание...'; }

        try {
            const res = await fetch('/api/v1/chats/create-channel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken()
                },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (res.ok) {
                closeCreateChannelModal();
                if (typeof showToast === 'function') showToast('success', 'Канал создан', '✓');
                if (typeof loadChats === 'function') await loadChats();
                if (typeof switchSection === 'function') switchSection('channels');
                setTimeout(function() {
                    const chat = typeof allChats !== 'undefined' && allChats.find(function(c) { return c.id === data.chatId; });
                    if (chat && typeof openChat === 'function') openChat(chat.id, chat.name || title);
                }, 400);
            } else {
                if (typeof showToast === 'function') showToast('error', data.error || 'Ошибка', '❌');
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('error', 'Ошибка сети', '❌');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Создать канал'; }
        }
    };

    window.openChannelDiscovery = function() {
        const q = prompt(tr('findChannelsPrompt', 'Введите название или @username канала'), '');
        if (!q) return;
        const input = document.getElementById('searchInput');
        if (input) {
            input.value = q;
            if (typeof handleUnifiedSearch === 'function') handleUnifiedSearch(q);
        }
        if (typeof switchSection === 'function') switchSection('channels');
    };

    window.subscribeToChannelFromSearch = async function(channelId, title) {
        try {
            const res = await fetch('/api/v1/channels/' + channelId + '/subscribe', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            const data = await res.json();
            if (res.ok) {
                if (typeof showToast === 'function') showToast('success', tr('subscribed', 'Вы подписались'), '✓');
                if (typeof loadChats === 'function') await loadChats();
                if (typeof openChat === 'function') openChat(channelId, title);
            } else {
                if (typeof showToast === 'function') showToast('error', data.error || 'Ошибка', '❌');
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('error', 'Ошибка сети', '❌');
        }
    };

    window.loadChannelMeta = async function(chat) {
        try {
            const res = await fetch('/api/v1/channels/' + chat.id, {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            if (res.ok) {
                const data = await res.json();
                chat.channelMeta = data.channel;
                chat.role = data.channel.role || chat.role;
                if (typeof activeChat !== 'undefined' && activeChat && activeChat.id === chat.id) {
                    activeChat.channelMeta = data.channel;
                    activeChat.role = data.channel.role || activeChat.role;
                }
                applyChannelComposerState(chat);
            }
        } catch (_) {}
    };

    window.applyChannelComposerState = function(chat) {
        if (typeof window.isCommentThreadActive === 'function' && window.isCommentThreadActive()) {
            return;
        }
        if (typeof window.restoreChannelFeedUi === 'function') {
            window.restoreChannelFeedUi();
        }
        cleanupChannelComposer();

        const inputArea = document.getElementById('mainInputArea');
        const meta = chat.channelMeta || {};
        const canPost = meta.canPost === true || meta.role === 'owner' || meta.role === 'admin';
        let bar = document.getElementById('channelSubscriberBar');
        if (!canPost) {
            if (inputArea) inputArea.style.display = 'none';
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'channelSubscriberBar';
                bar.className = 'channel-subscriber-bar';
                const chatView = document.getElementById('chatView');
                if (chatView) chatView.appendChild(bar);
            }
            bar.style.display = 'flex';
            bar.innerHTML = '<span class="channel-subscriber-bar-icon" aria-hidden="true">' + chIcon('comment', 16) + '</span>'
                + '<span>' + tr('channelReadOnly', 'Вы подписаны на канал. Комментируйте посты под публикациями') + '</span>';
        } else {
            if (inputArea) inputArea.style.display = 'flex';
            if (bar) bar.style.display = 'none';
            ensureChannelAdminTools();
            const msgInput = document.getElementById('msgInput');
            if (msgInput) {
                msgInput.setAttribute('data-placeholder', tr('channelPostPlaceholder', 'Напишите пост для канала...'));
            }
            if (typeof window._updateSendButton === 'function') {
                window._updateSendButton();
            }
        }
    };

    window.channelDefaultAvatarHtml = function(size) {
        return '<span class="channel-icon-placeholder" style="color:var(--accent-color);">' + chIcon('megaphone', size || 24) + '</span>';
    };

    function formatBtn(format, label, content) {
        return '<button type="button" class="channel-format-btn" onclick="formatInputText(\'' + format + '\')"'
            + ' title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">'
            + content + '</button>';
    }

    function ensureChannelAdminTools() {
        let tools = document.getElementById('channelAdminTools');
        if (tools && !tools.classList.contains('channel-format-bar')) {
            tools.remove();
            tools = null;
        }
        if (tools) return;
        const inputArea = document.getElementById('mainInputArea');
        if (!inputArea || !inputArea.parentNode) return;
        if (inputArea.parentNode.id === 'channelCommentsInputMount' && typeof window.restoreChannelFeedUi === 'function') {
            window.restoreChannelFeedUi();
        }
        tools = document.createElement('div');
        tools.id = 'channelAdminTools';
        tools.className = 'channel-format-bar';
        tools.innerHTML =
            '<div class="channel-format-bar-label">' + tr('formatting', 'Форматирование') + '</div>'
            + '<div class="channel-format-scroll">'
            + formatBtn('bold', tr('bold', 'Жирный'), '<span class="channel-format-glyph channel-format-glyph-bold">B</span>')
            + formatBtn('italic', tr('italic', 'Курсив'), '<span class="channel-format-glyph channel-format-glyph-italic">I</span>')
            + formatBtn('underline', tr('underline', 'Подчёркнутый'), '<span class="channel-format-glyph channel-format-glyph-underline">U</span>')
            + formatBtn('strikethrough', tr('strikethrough', 'Зачёркнутый'), '<span class="channel-format-glyph channel-format-glyph-strike">S</span>')
            + formatBtn('monospace', tr('monospace', 'Моноширинный'), '<span class="channel-format-glyph channel-format-glyph-mono">M</span>')
            + formatBtn('spoiler', tr('hidden', 'Скрытый'), '<span class="channel-format-glyph">' + chIcon('eyeOff', 15) + '</span>')
            + formatBtn('quote', tr('quote', 'Цитата'), '<span class="channel-format-glyph">' + chIcon('quote', 15) + '</span>')
            + '</div>';
        inputArea.parentNode.insertBefore(tools, inputArea);
    }

    window.getChannelPostExtras = function() {
        return {};
    };

    window.updatePostCommentCount = function(postId, count, commentPreview) {
        const postEl = document.querySelector('[data-message-id="' + postId + '"]');
        if (!postEl) return;
        const label = postEl.querySelector('.channel-post-comments-label');
        if (label) label.textContent = formatCommentsCount(count || 0);
        if (commentPreview !== undefined) {
            const avatarsEl = postEl.querySelector('.channel-post-comment-avatars');
            if (avatarsEl) avatarsEl.outerHTML = buildCommentAvatarsHtml(commentPreview);
        }
        const subtitle = document.getElementById('channelCommentsSubtitle');
        const activePostId = typeof window.getCommentThreadPostId === 'function' ? window.getCommentThreadPostId() : null;
        if (subtitle && activePostId === postId) {
            subtitle.textContent = formatCommentsCount(count || 0);
        }
    };

    window.openChannelComments = async function(postId) {
        if (!activeChat || activeChat.type !== 'channel') return;
        const resolvedId = resolveChannelPostId(postId);
        if (!resolvedId) {
            if (typeof showToast === 'function') {
                showToast('info', tr('waitForPostPublish', 'Дождитесь публикации поста'), '⏳');
            }
            return;
        }
        postId = resolvedId;
        if (typeof window.enterCommentThreadMode === 'function') {
            window.enterCommentThreadMode(postId);
        }

        const chatView = document.getElementById('chatView');
        const commentsView = document.getElementById('channelCommentsView');
        if (chatView) chatView.classList.add('channel-comments-mode');
        if (commentsView) commentsView.setAttribute('aria-hidden', 'false');

        const title = document.getElementById('channelCommentsTitle');
        if (title) title.textContent = tr('discussion', 'Обсуждение');

        const count = (typeof messagesData !== 'undefined' && messagesData[postId])
            ? (messagesData[postId].commentCount || 0)
            : 0;
        const subtitle = document.getElementById('channelCommentsSubtitle');
        if (subtitle) subtitle.textContent = formatCommentsCount(count);

        document.querySelectorAll('.channel-post-comments-btn.active').forEach(function(btn) {
            btn.classList.remove('active');
        });
        const activeBtn = document.querySelector('[data-message-id="' + postId + '"] .channel-post-comments-btn');
        if (activeBtn) activeBtn.classList.add('active');

        if (typeof window.loadCommentThread === 'function') {
            await window.loadCommentThread(postId);
        }

        const input = document.getElementById('msgInput');
        if (input) {
            setTimeout(function() { input.focus(); }, 80);
        }
    };

    window.closeChannelCommentsView = function() {
        if (typeof window.exitCommentThreadMode === 'function') {
            window.exitCommentThreadMode();
        }

        const list = document.getElementById('channelCommentsMessages');
        if (list) list.innerHTML = '';

        if (typeof activeChat !== 'undefined' && activeChat && activeChat.type === 'channel') {
            window.applyChannelComposerState(activeChat);
        }
    };

    window.closeChannelComments = window.closeChannelCommentsView;

    window.openChannelInfoModal = async function(chatId) {
        const chat = typeof allChats !== 'undefined' && allChats.find(function(c) { return c.id === chatId; });
        if (!chat) return;

        let channel = chat.channelMeta;
        try {
            const res = await fetch('/api/v1/channels/' + chatId, {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            if (res.ok) {
                const data = await res.json();
                channel = data.channel;
                chat.channelMeta = channel;
            }
        } catch (_) {}

        if (!channel) return;

        document.body.style.overflow = 'hidden';
        let modal = document.getElementById('channelInfoModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'channelInfoModal';
            modal.className = 'channel-info-overlay';
            modal.onclick = function(e) {
                if (e.target === modal) {
                    modal.remove();
                    document.body.style.overflow = '';
                }
            };
            document.body.appendChild(modal);
        }

        const isOwner = channel.role === 'owner';
        const canManage = channel.canManage;
        const uname = channel.username ? '@' + channel.username : '';
        const linkHtml = channel.isPublic && channel.username
            ? '<div class="channel-info-username">' + escapeHtml(uname) + '</div>'
            : '<div class="channel-info-private">' + tr('privateChannel', 'Приватный канал') + '</div>';

        const discussionHtml = channel.discussionChat
            ? '<button type="button" class="channel-info-action-btn" onclick="openChat(\'' + channel.discussionChat.id + '\', \'' + (channel.discussionChat.title || '').replace(/'/g, "\\'") + '\')">'
            + '<span class="channel-post-stat-icon">' + chIcon('comment', 16) + '</span>'
            + tr('openDiscussion', 'Открыть обсуждение') + '</button>'
            : (canManage ? '<button type="button" class="channel-info-action-btn channel-info-action-muted" onclick="linkChannelDiscussion(\'' + chatId + '\')">'
            + tr('linkDiscussion', 'Привязать группу обсуждения') + '</button>' : '');

        const avatarBlock = channel.avatarUrl
            ? '<div class="channel-info-avatar"><img src="' + escapeHtml(resolveAvatarUrl(channel.avatarUrl)) + '" alt=""></div>'
            : '<div class="channel-info-avatar channel-info-avatar-placeholder">' + chIcon('megaphone', 32) + '</div>';

        modal.innerHTML = '<div class="channel-info-sheet">'
            + '<div class="channel-info-close-row"><button type="button" class="channel-info-close" onclick="document.getElementById(\'channelInfoModal\').remove();document.body.style.overflow=\'\';" aria-label="' + escapeHtml(tr('close', 'Закрыть')) + '">' + chIcon('close', 20) + '</button></div>'
            + '<div class="channel-info-hero">' + avatarBlock
            + '<div class="channel-info-title">' + escapeHtml(channel.title || chat.name) + '</div>'
            + linkHtml
            + '<div class="channel-info-subs">' + (channel.subscriberCount || 0) + ' ' + tr('subscribers', 'подписчиков') + '</div>'
            + (channel.description ? '<p class="channel-info-desc">' + escapeHtml(channel.description) + '</p>' : '')
            + '</div>'
            + discussionHtml
            + '<div class="channel-info-actions">'
            + (isOwner ? '<button type="button" class="channel-info-danger-btn" onclick="deleteChannel(\'' + chatId + '\')">' + tr('deleteChannel', 'Удалить канал') + '</button>' : '')
            + (!isOwner ? '<button type="button" class="channel-info-action-btn" onclick="unsubscribeChannel(\'' + chatId + '\')">' + tr('unsubscribe', 'Отписаться') + '</button>' : '')
            + '</div></div>';
    };

    window.unsubscribeChannel = async function(chatId) {
        try {
            const res = await fetch('/api/v1/channels/' + chatId + '/subscribe', {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            if (res.ok) {
                document.getElementById('channelInfoModal')?.remove();
                document.body.style.overflow = '';
                if (typeof closeChat === 'function') closeChat();
                if (typeof loadChats === 'function') await loadChats();
                if (typeof showToast === 'function') showToast('success', tr('unsubscribed', 'Вы отписались'), '✓');
            }
        } catch (_) {}
    };

    window.deleteChannel = async function(chatId) {
        if (!confirm(tr('deleteChannelConfirm', 'Удалить канал? Это действие необратимо.'))) return;
        try {
            const res = await fetch('/api/v1/chats/' + chatId, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            if (res.ok) {
                document.getElementById('channelInfoModal')?.remove();
                if (typeof closeChat === 'function') closeChat();
                if (typeof loadChats === 'function') await loadChats();
            }
        } catch (_) {}
    };

    window.linkChannelDiscussion = async function(chatId) {
        const groupId = prompt(tr('linkDiscussionPrompt', 'Вставьте ID группового чата для обсуждения'), '');
        if (!groupId) return;
        try {
            const res = await fetch('/api/v1/channels/' + chatId + '/discussion', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken()
                },
                body: JSON.stringify({ discussionChatId: groupId.trim() })
            });
            const data = await res.json();
            if (res.ok) {
                if (typeof showToast === 'function') showToast('success', tr('discussionLinked', 'Группа привязана'), '✓');
                openChannelInfoModal(chatId);
            } else {
                if (typeof showToast === 'function') showToast('error', data.error || 'Ошибка', '❌');
            }
        } catch (_) {}
    };

    function initChannelModalChrome() {
        const titleIcon = document.getElementById('channelModalTitleIcon');
        const preview = document.getElementById('channelAvatarPreview');
        if (titleIcon && !titleIcon.innerHTML) {
            titleIcon.innerHTML = chIcon('megaphone', 18);
        }
        if (preview && !preview.querySelector('img') && !preview.querySelector('svg')) {
            preview.innerHTML = '<span class="channel-icon-placeholder">' + chIcon('megaphone', 28) + '</span>';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChannelModalChrome);
    } else {
        initChannelModalChrome();
    }

    document.addEventListener('click', function(e) {
        const modal = document.getElementById('createChannelModal');
        if (modal && e.target === modal) closeCreateChannelModal();
    });
})();

(function() {
    function createMediaAttachmentController(options) {
        const getActiveChat = options.getActiveChat || function() { return null; };
        const getUser = options.getUser || function() { return {}; };
        const getToken = options.getToken || function() { return ''; };
        const getMessagesData = options.getMessagesData || function() { return {}; };
        const setNewPackIconData = options.setNewPackIconData || function() {};
        const tr = options.tr || function(key, fallback) { return fallback || key; };
        const showToast = options.showToast || function() {};
        const maxFileSize = 50 * 1024 * 1024;
        let pendingMediaDataUrl = null;
        let pendingMediaType = null;

        function toggleAttachmentPanel() {
            const panel = document.getElementById('attachmentPanel');
            const btn = document.getElementById('mediaBtn');
            if (panel.classList.contains('active')) {
                panel.classList.remove('active');
                btn.classList.remove('active');
                return;
            }
            options.closeEmojiPicker();
            closeMediaPanel();
            panel.classList.add('active');
            btn.classList.add('active');
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
            if (!navigator.geolocation) {
                showToast('error', tr('geolocationUnsupported', 'Геолокация не поддерживается'), '❌');
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const locationUrl = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
                    options.sendMessage(tr('myLocationMessage', '📍 Моя геопозиция: {url}', { url: locationUrl }));
                },
                () => showToast('error', tr('geolocationError', 'Не удалось получить геопозицию'), '❌')
            );
        }

        function shareContact() {
            closeAttachmentPanel();
            options.showContactPicker();
        }

        function toggleMediaPanel() {
            const panel = document.getElementById('mediaPanel');
            const overlay = document.getElementById('mediaPanelOverlay');
            const btn = document.getElementById('mediaBtn');
            if (panel.classList.contains('active')) {
                closeMediaPanel();
                return;
            }
            panel.classList.add('active');
            overlay.classList.add('active');
            btn.classList.add('active');
        }

        function closeMediaPanel() {
            document.getElementById('mediaPanel').classList.remove('active');
            document.getElementById('mediaPanelOverlay').classList.remove('active');
            document.getElementById('mediaBtn').classList.remove('active');
        }

        function openCamera() {
            closeMediaPanel();
            document.getElementById('cameraInput').click();
        }

        function openGallery() {
            closeAttachmentPanel();
            document.getElementById('galleryInput').click();
        }

        function openStickerPicker() {
            closeMediaPanel();
            document.getElementById('stickerModal').classList.add('active');
            options.loadStickerPacks();
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
            setNewPackIconData(null);
        }

        function bindModalClosers() {
            const stickerModal = document.getElementById('stickerModal');
            if (stickerModal) {
                stickerModal.addEventListener('click', function(e) {
                    if (e.target.id === 'stickerModal') closeStickerModal();
                });
            }
            const createPackModal = document.getElementById('createPackModal');
            if (createPackModal) {
                createPackModal.addEventListener('click', function(e) {
                    if (e.target.id === 'createPackModal') closeCreatePackModal();
                });
            }
        }

        function handleFileSelect(input) {
            const file = input.files[0];
            if (!file) return;
            input.value = '';
            if (file.size > maxFileSize) {
                showToast('error', tr('fileTooLarge50', 'Файл слишком большой. Максимум 50 МБ'), '❌');
                return;
            }
            const reader = new FileReader();
            reader.onload = function(e) {
                showMediaSendPreview(e.target.result, file.type.startsWith('video') ? 'video' : 'image');
            };
            reader.readAsDataURL(file);
        }

        function handleGifSelect(input) {
            const file = input.files[0];
            if (!file) return;
            input.value = '';
            if (file.size > maxFileSize) {
                showToast('error', tr('fileTooLarge50', 'Файл слишком большой. Максимум 50 МБ'), '❌');
                return;
            }
            const reader = new FileReader();
            reader.onload = function(e) {
                uploadFile(e.target.result, 'gif').then(function(url) {
                    if (!url) return showToast('error', tr('loadingError', 'Ошибка загрузки'), '❌');
                    options.saveGif(url, file.name);
                    showToast('success', tr('gifAdded', 'GIF добавлен'), '✓');
                }).catch(function() {
                    showToast('error', tr('loadingError', 'Ошибка загрузки'), '❌');
                });
            };
            reader.readAsDataURL(file);
        }

        function showMediaSendPreview(dataUrl, type) {
            pendingMediaDataUrl = dataUrl;
            pendingMediaType = type;
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
            document.getElementById('mediaSendPreview').style.display = 'flex';
            if (window.lucide) lucide.createIcons();
            setTimeout(() => caption.focus(), 100);
            function onEsc(e) {
                if (e.key === 'Escape') {
                    cancelMediaSend();
                    document.removeEventListener('keydown', onEsc);
                }
            }
            document.addEventListener('keydown', onEsc);
        }

        function openEditorFromPreview() {
            if (!pendingMediaDataUrl) return;
            try {
                localStorage.setItem('craneapp_editor_image', pendingMediaDataUrl);
                document.getElementById('photoEditorIframe').src = '../../components/media-editor/photo-editor.html';
                document.getElementById('photoEditorModal').style.display = 'block';
            } catch (error) {
                console.error('Editor open error:', error);
                showToast('error', 'Изображение слишком большое для редактора', '❌');
            }
        }

        function closePhotoEditor() {
            const modal = document.getElementById('photoEditorModal');
            const iframe = document.getElementById('photoEditorIframe');
            if (modal) modal.style.display = 'none';
            if (iframe) iframe.src = 'about:blank';
        }

        function onPhotoEditorComplete(dataUrl) {
            pendingMediaDataUrl = dataUrl;
            const previewImg = document.getElementById('mediaSendPreviewImg');
            if (previewImg) previewImg.src = dataUrl;
        }

        function cancelMediaSend() {
            pendingMediaDataUrl = null;
            pendingMediaType = null;
            document.getElementById('mediaSendPreview').style.display = 'none';
        }

        function confirmMediaSend() {
            if (!pendingMediaDataUrl || !pendingMediaType) return;
            const dataUrl = pendingMediaDataUrl;
            const type = pendingMediaType;
            const caption = document.getElementById('mediaSendCaption').innerText.trim();
            document.getElementById('mediaSendPreview').style.display = 'none';
            pendingMediaDataUrl = null;
            pendingMediaType = null;
            if (type === 'gif') {
                options.saveGif(dataUrl);
                sendGifMessage(dataUrl, caption);
                return;
            }
            sendMediaMessage(dataUrl, type, caption);
        }

        function handlePackIconSelect(input) {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                setNewPackIconData(e.target.result);
                document.getElementById('newPackIcon').innerHTML = '<img src="' + e.target.result + '" alt="">';
            };
            reader.readAsDataURL(file);
            input.value = '';
        }

        function handleStickerSelect(input) {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) { options.addStickerToCurrentPack(e.target.result); };
            reader.readAsDataURL(file);
            input.value = '';
        }

        function sendMediaMessage(dataUrl, type, caption) {
            const activeChat = getActiveChat();
            if (!activeChat) return;
            const tempId = 'temp-' + Date.now();
            appendPendingMediaMessage(tempId, { type, mediaUrl: dataUrl, content: caption || '' });
            uploadFile(dataUrl, type, { messageMedia: true, chatId: activeChat.id }).then(function(upload) {
                if (upload && upload.url) sendMediaToServer(upload.url, type, tempId, caption, upload.mediaEncryption);
            });
        }

        function sendGifMessage(dataUrl, caption) {
            if (!getActiveChat()) return;
            setTimeout(function() {
                const tempId = 'temp-' + Date.now();
                appendPendingMediaMessage(tempId, { type: 'gif', mediaUrl: dataUrl, content: caption || '' });
                setTimeout(function() {
                    options.scrollToBottom();
                    const activeChat = getActiveChat();
                    uploadFile(dataUrl, 'gif', { messageMedia: true, chatId: activeChat.id }).then(function(upload) {
                        if (upload && upload.url) sendMediaToServer(upload.url, 'gif', tempId, caption, upload.mediaEncryption);
                    });
                }, 100);
            }, 100);
        }

        function sendStickerMessage(stickerUrl) {
            if (!getActiveChat()) return;
            closeStickerModal();
            const tempId = 'temp-' + Date.now();
            appendPendingMediaMessage(tempId, { type: 'sticker', mediaUrl: stickerUrl });
            const activeChat = getActiveChat();
            uploadFile(stickerUrl, 'sticker', { messageMedia: true, chatId: activeChat.id }).then(function(upload) {
                if (upload && upload.url) sendMediaToServer(upload.url, 'sticker', tempId, '', upload.mediaEncryption);
            });
        }

        function appendPendingMediaMessage(tempId, data) {
            const user = getUser();
            const msg = {
                id: tempId,
                senderId: user.id,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                senderName: user.firstName || 'Вы',
                pending: true,
                ...data,
            };
            getMessagesData()[tempId] = msg;
            document.getElementById('messages').appendChild(options.createMessageElement(msg));
            options.scrollToBottom();
        }

        async function uploadFile(dataUrl, type, uploadOptions) {
            const opts = uploadOptions || {};
            try {
                let filePayload = dataUrl;
                if (opts.messageMedia) {
                    filePayload = await encryptMessageMedia(dataUrl, type, opts.chatId);
                }
                const res = await fetch('/api/v2/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
                    body: JSON.stringify({
                        file: filePayload,
                        type: type,
                        purpose: opts.messageMedia ? 'message' : undefined,
                    }),
                });
                const data = await res.json();
                if (opts.messageMedia) {
                    return {
                        url: data.url,
                        mediaEncryption: data.encryption || stripCiphertext(filePayload),
                    };
                }
                return data.url;
            } catch (error) {
                console.error('Upload error:', error);
                showToast('error', tr('loadingError', 'Ошибка загрузки'), '❌');
                return null;
            }
        }

        async function sendMediaToServer(mediaUrl, mediaType, tempId, caption, mediaEncryption) {
            const activeChat = getActiveChat();
            if (!activeChat) return;
            const encryptedCaption = await encryptMessageCaption(caption || '', activeChat.id);
            fetch('/api/v2/messages/' + activeChat.id, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
                body: JSON.stringify({
                    content: encryptedCaption,
                    type: mediaType,
                    mediaUrl,
                    mediaType,
                    mediaEncrypted: true,
                    mediaEncryption,
                    isEncrypted: Boolean((caption || '').trim()),
                }),
            }).then((res) => res.json()).then(function(data) {
                if (data.message) confirmMessage(tempId, data.message);
            }).catch(function() {
                showToast('error', tr('sendError', 'Ошибка отправки'), '❌');
            });
        }

        async function encryptMessageMedia(dataUrlOrUrl, type, chatId) {
            const cryptoService = getCryptoService();
            const input = dataUrlOrUrl.startsWith('data:') ? dataUrlOrUrl : await urlToDataUrl(dataUrlOrUrl);
            const chatContext = await fetchChatCryptoContext(chatId);
            return cryptoService.encryptMedia(chatId, input, chatContext);
        }

        async function encryptMessageCaption(caption, chatId) {
            const text = (caption || '').trim();
            if (!text) return '';
            const cryptoService = getCryptoService();
            const chatContext = await fetchChatCryptoContext(chatId);
            if (chatContext.type === 'group') {
                return cryptoService.encryptGroup(chatId, text);
            }
            return cryptoService.encryptDM(text, chatContext.peerPublicKey);
        }

        function getCryptoService() {
            const cryptoService = options.cryptoService
                || window.CraneAppServices?.cryptoService
                || window.craneCryptoService
                || null;
            if (!cryptoService || typeof cryptoService.encryptMedia !== 'function') {
                throw new Error('E2E media crypto service is unavailable');
            }
            return cryptoService;
        }

        async function fetchChatCryptoContext(chatId) {
            if (options.getChatCryptoContext) {
                return options.getChatCryptoContext(chatId);
            }
            const res = await fetch('/api/v2/chats/' + chatId, {
                headers: { 'Authorization': 'Bearer ' + getToken() },
            });
            const data = await res.json();
            const chat = data.chat || data;
            return {
                ...chat,
                type: chat.type || 'private',
                peerPublicKey: chat.peerPublicKey || null,
            };
        }

        async function urlToDataUrl(url) {
            const response = await fetch(url);
            const blob = await response.blob();
            return new Promise(function(resolve, reject) {
                const reader = new FileReader();
                reader.onload = function(e) { resolve(e.target.result); };
                reader.onerror = function() { reject(reader.error); };
                reader.readAsDataURL(blob);
            });
        }

        function stripCiphertext(payload) {
            if (!payload || typeof payload !== 'object') return null;
            const metadata = { ...payload };
            delete metadata.ciphertext;
            return metadata;
        }

        function confirmMessage(tempId, serverMessage) {
            const tempEl = document.querySelector('[data-message-id="' + tempId + '"]');
            if (!tempEl) return;
            tempEl.dataset.messageId = serverMessage.id;
            tempEl.classList.remove('pending');
            const span = tempEl.querySelector('.msg-time span');
            if (span) {
                span.innerHTML = '<svg width="12" height="10" viewBox="0 0 12 10" fill="none" style="opacity:.7"><path d="M1 5l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            }
            delete getMessagesData()[tempId];
            getMessagesData()[serverMessage.id] = serverMessage;
        }

        bindModalClosers();

        return {
            cancelMediaSend,
            closeAttachmentPanel,
            closeCreatePackModal,
            closeMediaPanel,
            closePhotoEditor,
            closeStickerModal,
            confirmMediaSend,
            confirmMessage,
            handleFileSelect,
            handleGifSelect,
            handlePackIconSelect,
            handleStickerSelect,
            onPhotoEditorComplete,
            openCamera,
            openCreatePackModal,
            openEditorFromPreview,
            openFilePicker,
            openGallery,
            openStickerPicker,
            sendGifMessage,
            sendMediaMessage,
            sendStickerMessage,
            shareContact,
            shareLocation,
            showMediaSendPreview,
            toggleAttachmentPanel,
            toggleMediaPanel,
            uploadFile,
        };
    }

    window.CraneMediaAttachmentController = { create: createMediaAttachmentController };
})();

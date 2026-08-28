(function initBrowserNotifications(global) {
  function createBrowserNotifications({ getActiveChat, getUser, openChat, showToast }) {
    let notificationPermission = 'default';
    let notificationSettings = {
      desktop: true,
      sound: true,
      preview: true,
    };

    async function initNotifications() {
      if (!('Notification' in global)) {
        console.log('Браузер не поддерживает уведомления');
        return;
      }

      const saved = localStorage.getItem('craneapp_notification_settings');
      if (saved) {
        notificationSettings = JSON.parse(saved);
      }

      notificationPermission = Notification.permission;

      if (notificationPermission === 'default') {
        await requestNotificationPermission();
      }
    }

    async function requestNotificationPermission() {
      if (!('Notification' in global)) return false;

      try {
        const permission = await Notification.requestPermission();
        notificationPermission = permission;

        if (permission === 'granted') {
          showToast('success', 'Уведомления включены! 🔔', '✅');
          return true;
        }

        if (permission === 'denied') {
          showToast('error', 'Уведомления отключены в настройках браузера', '❌');
          return false;
        }
      } catch (error) {
        console.error('Ошибка запроса разрешений:', error);
      }

      return false;
    }

    function showBrowserNotification(title, options = {}) {
      if (!('Notification' in global)) return null;
      if (notificationPermission !== 'granted') return null;
      if (!notificationSettings.desktop) return null;

      const notification = new Notification(title, {
        icon: '/logo.png',
        badge: '/logo.png',
        tag: 'craneapp-message',
        requireInteraction: false,
        silent: !notificationSettings.sound,
        ...options,
      });

      setTimeout(() => notification.close(), 5000);
      notification.onclick = () => {
        global.focus();
        notification.close();

        if (options.data?.chatId) {
          openChat(options.data.chatId, options.data.chatName);
        }
      };

      return notification;
    }

    function notifyNewMessage(message, chatInfo) {
      const activeChat = getActiveChat();
      const user = getUser();

      if (activeChat && activeChat.id === chatInfo.id && document.hasFocus()) return;
      if (message.senderId === user.id) return;
      if (!notificationSettings.desktop) return;

      if (notificationPermission === 'default') {
        requestNotificationPermission().then((granted) => {
          if (granted) showNotificationNow(message, chatInfo);
        });
        return;
      }

      if (notificationPermission === 'granted') {
        showNotificationNow(message, chatInfo);
      }
    }

    function showNotificationNow(message, chatInfo) {
      const senderName = message.senderFirstName
        || message.sender?.firstName
        || message.senderName
        || 'Пользователь';
      const notificationContent = getMessageNotificationContent(message);
      const title = chatInfo.type === 'group' || chatInfo.type === 'channel'
        ? `${chatInfo.name} • ${senderName}`
        : senderName;

      showBrowserNotification(title, {
        body: notificationContent.body,
        icon: notificationContent.icon,
        tag: `chat-${chatInfo.id}`,
        data: {
          chatId: chatInfo.id,
          chatName: chatInfo.name,
          messageId: message.id,
        },
        requireInteraction: message.type === 'call',
      });
    }

    function updateNotificationSettings(settings) {
      notificationSettings = { ...notificationSettings, ...settings };
      localStorage.setItem('craneapp_notification_settings', JSON.stringify(notificationSettings));
    }

    return {
      initNotifications,
      notifyNewMessage,
      requestNotificationPermission,
      showBrowserNotification,
      showNotificationNow,
      updateNotificationSettings,
    };
  }

  function getMessageNotificationContent(message) {
    if (message.type === 'text' || !message.type) {
      const text = message.content || message.text || '';
      return {
        body: text.length > 100 ? `${text.substring(0, 100)}...` : text,
        icon: '/logo.png',
      };
    }

    const mediaIcon = message.mediaUrl || '/logo.png';
    const contentByType = {
      image: { body: '📷 Фото', icon: mediaIcon },
      photo: { body: '📷 Фото', icon: mediaIcon },
      video: { body: '🎬 Видео', icon: '/logo.png' },
      sticker: { body: '🎨 Стикер', icon: mediaIcon },
      gif: { body: '🎬 GIF', icon: mediaIcon },
      file: { body: '📎 Файл', icon: '/logo.png' },
    };

    return contentByType[message.type] || {
      body: message.content || 'Новое сообщение',
      icon: '/logo.png',
    };
  }

  global.CraneBrowserNotifications = {
    create: createBrowserNotifications,
  };
})(window);

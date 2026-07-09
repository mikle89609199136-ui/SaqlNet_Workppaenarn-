(function initSessionGreeting(global) {
  function createSessionGreeting({ getToken, getUser, showToastContainerId = 'toastContainer' }) {
    function getDeviceInfo() {
      const userAgent = navigator.userAgent;

      if (/tablet/i.test(userAgent)) return 'планшета';
      if (/iPad/i.test(userAgent)) return 'iPad';
      if (/iPhone/i.test(userAgent)) return 'iPhone';
      if (/Android/i.test(userAgent)) return 'Android-устройства';
      if (/mobile/i.test(userAgent)) return 'мобильного устройства';
      if (/Windows/i.test(userAgent)) return 'Windows';
      if (/Mac/i.test(userAgent)) return 'Mac';
      if (/Linux/i.test(userAgent)) return 'Linux';

      return 'устройства';
    }

    function getCurrentTime() {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    function checkSessionAndShowGreeting() {
      fetch('/api/v2/auth/sessions', {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
        .then((response) => response.json())
        .then((data) => {
          if (!data.sessions || data.sessions.length <= 1) return;

          const user = getUser();
          const userName = user.firstName || user.username || 'пользователь';
          const greeting = [
            `Здравствуйте, ${userName}, кто-то вошел в ваш аккаунт с ${getDeviceInfo()} в ${getCurrentTime()}.`,
            '',
            'Если это были не вы, НЕЗАМЕДЛИТЕЛЬНО завершите сеанс в настройках.',
          ].join('\n');

          showCraneAppGreeting(greeting);
        })
        .catch((error) => {
          console.error('Session check error:', error);
        });
    }

    function showCraneAppGreeting(message) {
      const container = document.getElementById(showToastContainerId);
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = 'toast craneapp-greeting';
      toast.innerHTML = '<div class="craneapp-greeting-header"><span>🤖 CraneApp</span></div>'
        + `<div class="craneapp-greeting-body">${message.replace(/\n/g, '<br>')}</div>`;

      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }, 10000);
    }

    return {
      checkSessionAndShowGreeting,
      getCurrentTime,
      getDeviceInfo,
      showCraneAppGreeting,
    };
  }

  global.CraneSessionGreeting = {
    create: createSessionGreeting,
  };
})(window);

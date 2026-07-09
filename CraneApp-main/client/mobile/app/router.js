export const router = {
    init() {
        const token = localStorage.getItem('token');
        const path = window.location.pathname;
        
        // Нет токена → на вход
        if (!token && !path.includes('login.html') && !path.includes('register.html')) {
            window.location.href = '/mobile/login';
            return;
        }
        
        // Есть токен + страница входа → в чаты
        if (token && (path.includes('login.html') || path.includes('register.html'))) {
            window.location.href = '/mobile/chats';
            return;
        }

        // Простейшая маршрутизация Settings (план А)
        if (path.includes('settings') || path.includes('settings.html')) {
            window.location.href = '/mobile/settings';
            return;
        }
    }
};

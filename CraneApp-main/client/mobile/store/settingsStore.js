export const settingsStore = {
    defaults: {
        theme: 'dark',
        language: 'ru',
        accentColor: '#FF007F',
        fontSize: 'medium',
        notifications: true,
        vibration: true,
        showPreview: true,
        badgeCount: true,
        chatNotifications: true,
        channelNotifications: false,
        online: true,
        readReceipts: true,
        lastSeen: true,
        photoVisible: 'all',
        forwardVisible: 'all',
        spamFilter: false
    },

    getSettings() {
        const saved = localStorage.getItem('craneapp_settings');
        return saved ? { ...this.defaults, ...JSON.parse(saved) } : { ...this.defaults };
    },

    saveSettings(settings) {
        localStorage.setItem('craneapp_settings', JSON.stringify(settings));
        this.applySettings(settings);
    },

    updateSetting(key, value) {
        const settings = this.getSettings();
        settings[key] = value;
        this.saveSettings(settings);
    },

    toggleSetting(key) {
        const settings = this.getSettings();
        settings[key] = !settings[key];
        this.saveSettings(settings);
        return settings[key];
    },

    applySettings(settings) {
        // Применяем тему
        document.documentElement.setAttribute('data-theme', settings.theme);
        
        // Применяем цвет акцента
        document.documentElement.style.setProperty('--accent-color', settings.accentColor);
        
        // Применяем размер шрифта
        const fontSizes = { small: '14px', medium: '16px', large: '18px' };
        document.documentElement.style.setProperty('--base-font-size', fontSizes[settings.fontSize] || '16px');
        
        // Применяем язык
        document.documentElement.setAttribute('lang', settings.language);
    },

    init() {
        const settings = this.getSettings();
        this.applySettings(settings);
    }
};

// Авто-инициализация при загрузке
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        settingsStore.init();
    });
}
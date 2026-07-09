import { apiClient } from '../infrastructure/api/apiFactory.js';
import { STORAGE_KEYS } from '../shared/constants/config.js';

const { TOKEN: TOKEN_KEY, USER: USER_KEY } = STORAGE_KEYS;

export const authStore = {
    getToken() {
        return localStorage.getItem(TOKEN_KEY);
    },

    setToken(token) {
        localStorage.setItem(TOKEN_KEY, token);
    },

    removeToken() {
        localStorage.removeItem(TOKEN_KEY);
    },

    getUser() {
        const data = localStorage.getItem(USER_KEY);
        if (!data) return null;

        try {
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to parse auth user:', error);
            this.removeUser();
            return null;
        }
    },

    setUser(user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    },

    removeUser() {
        localStorage.removeItem(USER_KEY);
    },

    isAuthenticated() {
        return !!this.getToken() && !!this.getUser();
    },

    logout() {
        this.removeToken();
        this.removeUser();
    },

    async validateSession() {
        const token = this.getToken();
        if (!token) return false;

        try {
            const response = await apiClient.get('/auth/validate');
            this.setUser(response.data.user);
            return true;
        } catch (error) {
            console.error('Session validation error:', error);
            this.logout();
            return false;
        }
    }
};

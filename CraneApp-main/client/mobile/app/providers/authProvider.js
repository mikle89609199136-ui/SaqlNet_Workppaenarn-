/**
 * Authentication Provider
 * Manages auth state across the application
 */

import { authStore } from '../../store/authStore.js';
import { userApi } from '../../services/api/userApi.js';

export const authProvider = {
  initialized: false,
  currentUser: null,

  async init() {
    if (this.initialized) return;

    try {
      const token = authStore.getToken();
      
      if (token) {
        try {
          this.currentUser = await userApi.getMe();
          authStore.setUser(this.currentUser);
        } catch (error) {
          // Token expired or invalid
          authStore.removeToken();
          this.currentUser = null;
        }
      }

      this.initialized = true;
    } catch (error) {
      console.error('Auth provider init error:', error);
    }
  },

  isAuthenticated() {
    return authStore.isAuthenticated() && this.currentUser !== null;
  },

  getCurrentUser() {
    return this.currentUser;
  },

  getToken() {
    return authStore.getToken();
  },

  logout() {
    authStore.logout();
    this.currentUser = null;
    window.location.href = '/mobile/login';
  },

  updateUser(userData) {
    this.currentUser = { ...this.currentUser, ...userData };
    authStore.setUser(this.currentUser);
  }
};

import { config } from '../../app/config.js';
import { authStore } from '../../store/authStore.js';

/**
 * User API Service
 * Handles all user-related HTTP requests
 */
export const userApi = {
  baseUrl: `${config.apiBaseUrl}/users`,

  async getMe() {
    const token = authStore.getToken();
    const response = await fetch(`${this.baseUrl}/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch user profile');
    }

    const data = await response.json();
    authStore.setUser(data);
    return data;
  },

  async updateProfile(data) {
    const token = authStore.getToken();
    const response = await fetch(`${this.baseUrl}/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update profile');
    }

    return response.json();
  },

  async getUser(userId) {
    const token = authStore.getToken();
    const response = await fetch(`${this.baseUrl}/${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch user');
    }

    return response.json();
  },

  async blockUser(userId) {
    const token = authStore.getToken();
    const response = await fetch(`${this.baseUrl}/block`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to block user');
    }

    return response.json();
  },

  async unblockUser(userId) {
    const token = authStore.getToken();
    const response = await fetch(`${this.baseUrl}/unblock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to unblock user');
    }

    return response.json();
  },

  async getBlockedUsers() {
    const token = authStore.getToken();
    const response = await fetch(`${this.baseUrl}/blocked`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch blocked users');
    }

    return response.json();
  }
};
/**
 * Theme Provider
 * Manages application theme (dark/light/custom)
 */

import { colors } from '../../theme/colors.json';
import { settingsStore } from '../../store/settingsStore.js';

export const themeProvider = {
  initialized: false,
  currentTheme: 'dark',

  async init() {
    if (this.initialized) return;

    try {
      await settingsStore.loadSettings();
      this.currentTheme = settingsStore.getState().theme;
      this.applyTheme(this.currentTheme);
      this.initialized = true;
    } catch (error) {
      console.error('Theme provider init error:', error);
      this.applyTheme('dark');
    }
  },

  applyTheme(themeName) {
    const root = document.documentElement;
    
    if (themeName === 'dark') {
      root.style.setProperty('--bg-primary', colors.background);
      root.style.setProperty('--bg-surface', colors.surface);
      root.style.setProperty('--text-primary', colors.textPrimary);
      root.style.setProperty('--text-secondary', colors.textSecondary);
      root.style.setProperty('--primary', colors.primary);
      root.style.setProperty('--secondary', colors.secondary);
    } else if (themeName === 'light') {
      root.style.setProperty('--bg-primary', '#FFFFFF');
      root.style.setProperty('--bg-surface', '#F5F5F5');
      root.style.setProperty('--text-primary', '#000000');
      root.style.setProperty('--text-secondary', '#666666');
      root.style.setProperty('--primary', colors.primary);
      root.style.setProperty('--secondary', colors.secondary);
    }

    this.currentTheme = themeName;
  },

  setTheme(themeName) {
    settingsStore.setTheme(themeName);
    this.applyTheme(themeName);
  },

  getTheme() {
    return this.currentTheme;
  },

  toggleTheme() {
    const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
  }
};
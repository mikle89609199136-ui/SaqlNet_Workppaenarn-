/**
 * CraneApp Main Application Entry Point
 */

import { config } from './config.js';
import { authProvider } from './providers/authProvider.js';
import { themeProvider } from './providers/themeProvider.js';
import { socketProvider } from './providers/socketProvider.js';
import { navigation } from './navigation.js';

class CraneApp {
  constructor() {
    this.initialized = false;
    this.version = config.version;
  }

  async init() {
    if (this.initialized) return;

    try {
      // Initialize providers
      await themeProvider.init();
      await authProvider.init();
      await socketProvider.init();

      // Setup navigation
      navigation.init();

      // Check auth state
      const isAuthenticated = authProvider.isAuthenticated();
      
      if (isAuthenticated) {
        navigation.navigate('/mobile/chats');
      } else {
        navigation.navigate('/mobile/login');
      }

      this.initialized = true;
      console.log('✅ CraneApp initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize CraneApp:', error);
      this.showError('Failed to load application');
    }
  }

  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #000000;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    `;
    errorDiv.innerHTML = `
      <h1 style="color: #FF4B4B; margin-bottom: 16px;">Error</h1>
      <p>${message}</p>
      <button onclick="location.reload()" style="
        margin-top: 24px;
        padding: 12px 24px;
        background: linear-gradient(135deg, #FF007F, #9D00FF);
        color: white;
        border: none;
        border-radius: 12px;
        cursor: pointer;
      ">Retry</button>
    `;
    document.body.appendChild(errorDiv);
  }
}

// Start application
const app = new CraneApp();
document.addEventListener('DOMContentLoaded', () => app.init());

export { app };

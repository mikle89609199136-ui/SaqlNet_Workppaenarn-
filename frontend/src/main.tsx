import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startCryptoAutoInit } from './services/serviceContainer';

// Global Scripts
import './apple-emoji.js';
import './configs/i18n.js';

// Styles
import './styles/tailwind.css';

// Ключи шифрования готовятся здесь, а не при импорте контейнера сервисов:
// импорт не должен ничего запускать.
startCryptoAutoInit();

createRoot(document.getElementById('appRoot')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

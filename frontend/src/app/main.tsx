import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerChatResolver } from '@/queries/chat/chatResolverBridge';
import { startCryptoAutoInit } from '@/services/serviceContainer';

// Global Scripts
import '@/shared/i18n';

// Styles
import './styles/tailwind.css';

// Шифрование спрашивает данные чата у слоя запросов. Связь ставится до
// первого рендера: без неё первая же операция останется без ключа.
registerChatResolver();

// Ключи шифрования готовятся здесь, а не при импорте контейнера сервисов:
// импорт не должен ничего запускать.
startCryptoAutoInit();

createRoot(document.getElementById('appRoot')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

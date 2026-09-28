import { registerChatResolver } from '@/entities/chat';
import { registerAuthInterceptor } from '@/features/auth';
import { startCryptoAutoInit } from '@/services/serviceContainer';
import {
  registerServiceWorker,
  reloadOnStaleBuild,
  requestPersistentStorage,
  syncThemeColor,
} from '@/shared/lib';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Global Scripts
import '@/shared/i18n';

// Styles
import './styles/tailwind.css';

// Шифрование спрашивает данные чата у слоя запросов. Связь ставится до
// первого рендера: без неё первая же операция останется без ключа.
registerChatResolver();

// Реакция на 401: при истёкшей сессии объявляется событие разлогина.
// Связка настраивается здесь, чтобы транспортный слой shared/api не зависел от фич.
registerAuthInterceptor();

// Ключи шифрования готовятся здесь, а не при импорте контейнера сервисов:
// импорт не должен ничего запускать.
startCryptoAutoInit();

// PWA (#880): установка на экран «Домой»; строка состояния — цвета темы.
syncThemeColor();
void registerServiceWorker();
// Открытая вкладка после деплоя — перезагрузка вместо ошибки загрузки.
reloadOnStaleBuild();
// Ключи шифрования — в хранилище, которое браузер не чистит без спроса.
void requestPersistentStorage();

createRoot(document.getElementById('appRoot')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

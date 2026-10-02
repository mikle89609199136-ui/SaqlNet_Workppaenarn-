import { registerChatResolver } from '@/entities/chat';
import { registerAuthInterceptor } from '@/features/auth';
import { startCryptoAutoInit } from '@/services/serviceContainer';
import { exchangeLegacySession } from '@/shared/api';
import {
  preventStrayFileDrop,
  registerServiceWorker,
  reloadOnStaleBuild,
  requestPersistentStorage,
  syncThemeColor,
} from '@/shared/lib';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

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

preventStrayFileDrop();

// PWA (#880): установка на экран «Домой»; строка состояния — цвета темы.
syncThemeColor();
void registerServiceWorker();
// Открытая вкладка после деплоя — перезагрузка вместо ошибки загрузки.
reloadOnStaleBuild();
// Ключи шифрования — в хранилище, которое браузер не чистит без спроса.
void requestPersistentStorage();

/* Сессия — в cookie (#705). Вошедший до перехода хранит токен в
   localStorage: он меняется на cookie до первого запроса, иначе запросы
   ушли бы без сессии, вернули 401 — и человека выкинуло бы из аккаунта.
   Поэтому всё, что ходит в API, стартует после обмена: подготовка ключей
   шифрования и само приложение — роутер загружает данные уже при импорте.
   Без старого токена обмена нет — сразу. */
void exchangeLegacySession().finally(async () => {
  // Ключи шифрования готовятся здесь, а не при импорте контейнера сервисов:
  // импорт не должен ничего запускать.
  startCryptoAutoInit();
  const { App } = await import('./App');
  createRoot(document.getElementById('appRoot')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});

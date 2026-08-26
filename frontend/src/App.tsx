import { router } from '@/configs';
import { queryClient } from '@/queries/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { NotificationManager } from './components/layouts/NotificationManager.js';
import { RealtimeEvents } from './realtime/RealtimeEvents';
import { CallOverlay, CallProvider } from './components/index.js';

export function App() {
  return (
    // Провайдер оборачивает роутер: загрузчики маршрутов работают с тем же
    // клиентом, что и компоненты, иначе предзагруженные данные до них не дойдут.
    <QueryClientProvider client={queryClient}>
      <CallProvider>
        <CallOverlay />
        <RouterProvider router={router} />
        <RealtimeEvents />
        <NotificationManager />
      </CallProvider>
    </QueryClientProvider>
  );
}

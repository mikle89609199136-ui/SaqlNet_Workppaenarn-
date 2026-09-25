import { router } from './router';
import { queryClient } from '@/shared/api';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { NotificationManager, RealtimeEvents } from './providers';
import { CallOverlay, CallProvider } from '@/features/call';

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

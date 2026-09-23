import { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { allSettingsQuery } from './allSettingsQuery';

describe('allSettingsQuery', () => {
  it('запрашивает все настройки пользователя единым запросом', async () => {
    const mockAllSettings = {
      privacySettings: { lastSeen: 'nobody' as const },
      notificationSettings: { privateChats: true, messagePreview: true },
      soundSettings: { notificationsVolume: 80, mediaVolume: 100 },
      storageSettings: { maxCacheSizeMb: 500 },
      advancedSettings: { autoReconnect: true, hardwareAcceleration: true },
      folders: [{ id: 'f-1', name: 'Work' }],
      passcodeEnabled: true,
      passcodeTimeout: 60,
    };

    server.use(
      http.get(api('/users/all-settings'), () => HttpResponse.json(mockAllSettings))
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = await queryClient.fetchQuery(allSettingsQuery());

    expect(result).toEqual(mockAllSettings);
  });

  it('содержит корректный queryKey и staleTime', () => {
    const options = allSettingsQuery();
    expect(options.queryKey).toEqual(['user', 'all-settings']);
    expect(options.staleTime).toBe(300000);
  });
});

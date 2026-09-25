import { beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { uploadAvatar, fetchUserSettings } from './authApi';
import { DEFAULT_PROFILE_SETTINGS } from '@/entities/user/model/defaultProfileSettings';

describe('authApi: uploadAvatar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it('does nothing when no avatar is provided', async () => {
    const uploadSpy = vi.spyOn(services.mediaService, 'upload');
    const updateSpy = vi.spyOn(services.userService, 'updateAvatar');

    await uploadAvatar(null);
    await uploadAvatar(undefined);

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('uploads File via mediaService and updates avatar with returned url', async () => {
    const file = new File(['avatar content'], 'avatar.png', { type: 'image/png' });
    vi.spyOn(services.mediaService, 'upload').mockResolvedValue({
      url: '/api/v2/media/uploaded-id',
    });
    const updateSpy = vi.spyOn(services.userService, 'updateAvatar').mockResolvedValue({
      avatarUrl: '/api/v2/media/uploaded-id',
    } as any);

    await uploadAvatar(file);

    expect(services.mediaService.upload).toHaveBeenCalledWith(file);
    expect(updateSpy).toHaveBeenCalledWith('/api/v2/media/uploaded-id');
  });

  it('directly calls updateAvatar when avatar is already a string url', async () => {
    const uploadSpy = vi.spyOn(services.mediaService, 'upload');
    const updateSpy = vi.spyOn(services.userService, 'updateAvatar').mockResolvedValue({
      avatarUrl: 'https://example.com/pic.jpg',
    } as any);

    await uploadAvatar('https://example.com/pic.jpg');

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith('https://example.com/pic.jpg');
  });
});

describe('authApi: fetchUserSettings', () => {
  it('returns user settings from userService', async () => {
    vi.spyOn(services.userService, 'getSettings').mockResolvedValue({
      settings: { theme: 'dark' } as any,
    });

    const result = await fetchUserSettings();
    expect(result.theme).toBe('dark');
  });

  it('falls back to DEFAULT_PROFILE_SETTINGS on failure', async () => {
    vi.spyOn(services.userService, 'getSettings').mockRejectedValue(new Error('network error'));

    const result = await fetchUserSettings();
    expect(result).toEqual(DEFAULT_PROFILE_SETTINGS);
  });
});

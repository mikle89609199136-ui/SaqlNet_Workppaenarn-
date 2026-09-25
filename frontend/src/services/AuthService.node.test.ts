import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './AuthService';

describe('AuthService.logoutAll', () => {
  it('clears the local profile only after the server confirms revocation', async () => {
    const post = vi.fn().mockResolvedValue({ data: { success: true } });
    const clearProfile = vi.fn();
    const service = new AuthService({ post }, { clearProfile });

    await service.logoutAll();

    expect(clearProfile).toHaveBeenCalledOnce();
  });

  it('keeps the local profile when server-side revocation fails', async () => {
    const failure = new Error('service unavailable');
    const post = vi.fn().mockRejectedValue(failure);
    const clearProfile = vi.fn();
    const service = new AuthService({ post }, { clearProfile });

    await expect(service.logoutAll()).rejects.toBe(failure);
    expect(clearProfile).not.toHaveBeenCalled();
  });
});

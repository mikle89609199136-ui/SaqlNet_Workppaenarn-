import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '@/shared/api';
import { handleAuthUnauthorized, registerAuthInterceptor } from './registerAuthInterceptor';

describe('registerAuthInterceptor', () => {
  it('should announce expired session on token/session 401', () => {
    const listener = vi.fn();
    window.addEventListener('craneapp:unauthorized', listener);

    const error = Object.assign(new Error('Unauthorized'), {
      status: 401,
      code: 'token_expired',
      data: null,
    });

    handleAuthUnauthorized(error);

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('craneapp:unauthorized', listener);
  });

  it('should stay silent on user-facing auth error (wrong_password)', () => {
    const listener = vi.fn();
    window.addEventListener('craneapp:unauthorized', listener);

    const error = Object.assign(new Error('Wrong password'), {
      status: 401,
      code: 'wrong_password',
      data: null,
    });

    handleAuthUnauthorized(error);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('craneapp:unauthorized', listener);
  });

  it('should wire interceptor into given ApiClient instance', () => {
    const client = new ApiClient('http://localhost');
    const setOnUnauthorizedSpy = vi.spyOn(client, 'setOnUnauthorized');

    registerAuthInterceptor(client);

    expect(setOnUnauthorizedSpy).toHaveBeenCalledWith(handleAuthUnauthorized);
  });
});

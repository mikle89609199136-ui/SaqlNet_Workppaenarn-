import { describe, expect, it } from 'vitest';
import { isUserFacingAuthError } from './authErrors';

describe('isUserFacingAuthError', () => {
  it('should identify user-facing auth error codes', () => {
    expect(isUserFacingAuthError('wrong_password')).toBe(true);
    expect(isUserFacingAuthError('invalid_2fa')).toBe(true);
    expect(isUserFacingAuthError('invalid_credentials')).toBe(true);
  });

  it('should return false for session or other error codes', () => {
    expect(isUserFacingAuthError('unauthorized')).toBe(false);
    expect(isUserFacingAuthError('token_expired')).toBe(false);
    expect(isUserFacingAuthError('some_other_code')).toBe(false);
    expect(isUserFacingAuthError(undefined)).toBe(false);
    expect(isUserFacingAuthError('')).toBe(false);
  });
});

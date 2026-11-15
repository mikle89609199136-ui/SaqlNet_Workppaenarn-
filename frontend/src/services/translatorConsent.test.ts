import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config';
import { useProfileStore } from '@/entities/user/model/profileStore';
import { hasTranslatorConsent, rememberTranslatorConsent } from './translatorConsent';

describe('translatorConsent', () => {
  beforeEach(() => {
    localStorage.clear();
    useProfileStore.setState({ user: null });
    vi.restoreAllMocks();
  });

  it('возвращает false, если пользователь не авторизован', () => {
    expect(hasTranslatorConsent()).toBe(false);
    rememberTranslatorConsent();
    expect(hasTranslatorConsent()).toBe(false);
    expect(localStorage.getItem('craneapp_translator_consent:unknown')).toBeNull();
  });

  it('определяет userId из useProfileStore и сохраняет согласие', () => {
    useProfileStore.setState({
      user: {
        id: 'user-profile-123',
        username: 'alice',
        email: 'alice@example.com',
        phone: '',
        profilePictureUrl: '',
        bio: '',
        lastSeenAt: '',
        isOnline: true,
      },
    });

    expect(hasTranslatorConsent()).toBe(false);
    rememberTranslatorConsent();
    expect(hasTranslatorConsent()).toBe(true);
    expect(localStorage.getItem('craneapp_translator_consent:user-profile-123')).toBe('yes');
  });

  it('определяет userId из localStorage, если profileStore пуст', () => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 'user-storage-456' }));

    expect(hasTranslatorConsent()).toBe(false);
    rememberTranslatorConsent();
    expect(hasTranslatorConsent()).toBe(true);
    expect(localStorage.getItem('craneapp_translator_consent:user-storage-456')).toBe('yes');
  });

  it('не сохраняет согласие при поврежденном json в localStorage', () => {
    localStorage.setItem(STORAGE_KEYS.USER, '{broken_json');

    expect(hasTranslatorConsent()).toBe(false);
    rememberTranslatorConsent();
    expect(hasTranslatorConsent()).toBe(false);
  });
});

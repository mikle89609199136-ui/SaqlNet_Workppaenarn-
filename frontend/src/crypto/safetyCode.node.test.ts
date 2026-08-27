import { beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateIdentity } from './identity';
import { useMemoryKeyStore } from './keyStore';
import { safetyCodeFromFingerprint } from './safetyCode';
import {
  acknowledgeIdentityChange,
  forgetSecurityNotices,
  noteIdentityChange,
  readFirstSecurityNotice,
  readSecurityNotice,
} from './securityNotices';

beforeEach(() => {
  useMemoryKeyStore();
  forgetSecurityNotices();
});

describe('код безопасности', () => {
  it('should be readable aloud', async () => {
    // Код существует ради одного действия: двое читают его друг другу.
    // Значит он должен делиться на куски и состоять из знаков, которые не
    // спутать на слух.
    const identity = await loadOrCreateIdentity('alice');
    const code = safetyCodeFromFingerprint(identity.fingerprint)!;

    expect(code.split(' ')).toHaveLength(8);
    expect(code).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){7}$/);
  });

  it('should be the same code for the same keys', async () => {
    const identity = await loadOrCreateIdentity('alice');

    expect(safetyCodeFromFingerprint(identity.fingerprint)).toBe(
      safetyCodeFromFingerprint(identity.fingerprint)
    );
  });

  it('should differ for different people', async () => {
    const alice = await loadOrCreateIdentity('alice');
    const boris = await loadOrCreateIdentity('boris');

    expect(safetyCodeFromFingerprint(alice.fingerprint)).not.toBe(
      safetyCodeFromFingerprint(boris.fingerprint)
    );
  });

  it('should return nothing when there is nothing to show', () => {
    // Собеседник мог ещё не входить с версией, которая публикует ключи.
    expect(safetyCodeFromFingerprint('')).toBeNull();
    expect(safetyCodeFromFingerprint('коротко')).toBeNull();
  });
});

describe('отметка о смене ключа', () => {
  it('should appear when the keys change', async () => {
    await noteIdentityChange('boris', 'старый-отпечаток', 'новый-отпечаток');

    expect(readSecurityNotice('boris')).toMatchObject({
      userId: 'boris',
      previousFingerprint: 'старый-отпечаток',
      currentFingerprint: 'новый-отпечаток',
    });
  });

  it('should say nothing when the keys are the same', async () => {
    await noteIdentityChange('boris', 'тот-же', 'тот-же');

    expect(readSecurityNotice('boris')).toBeNull();
  });

  it('should go away once the person accepted it', async () => {
    await noteIdentityChange('boris', 'старый', 'новый');
    await acknowledgeIdentityChange('boris');

    expect(readSecurityNotice('boris')).toBeNull();
  });

  it('should not come back after a reload', async () => {
    // Принятое запоминается на устройстве: иначе одна и та же смена
    // всплывала бы при каждой загрузке и её перестали бы замечать.
    await noteIdentityChange('boris', 'старый', 'новый');
    await acknowledgeIdentityChange('boris');

    forgetSecurityNotices();
    await noteIdentityChange('boris', 'старый', 'новый');

    expect(readSecurityNotice('boris')).toBeNull();
  });

  it('should appear again when the keys change once more', async () => {
    await noteIdentityChange('boris', 'первый', 'второй');
    await acknowledgeIdentityChange('boris');

    await noteIdentityChange('boris', 'второй', 'третий');

    expect(readSecurityNotice('boris')?.currentFingerprint).toBe('третий');
  });

  it('should find the first notice among chat members', async () => {
    await noteIdentityChange('carol', 'старый', 'новый');

    expect(readFirstSecurityNotice(['alice', 'boris', 'carol'])?.userId).toBe('carol');
    expect(readFirstSecurityNotice(['alice', 'boris'])).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPasskeySlot } from './keyBackup';
import {
  evaluatePasskeySlots,
  PasskeyCancelledError,
  PasskeyNotAllowedHereError,
  registerPasskey,
} from './passkey';

const SLOT: IPasskeySlot = {
  type: 'passkey',
  id: 'slot-1',
  credentialId: 'AAAA',
  prfSalt: 'AAAA',
  iv: '',
  ct: '',
};

/** Браузер отвечает на вызов WebAuthn так, как ответил бы человеку. */
function browserAnswers(method: 'get' | 'create', answer: () => Promise<unknown>) {
  vi.stubGlobal('window', { location: { hostname: 'localhost' } });
  vi.stubGlobal('navigator', { credentials: { get: answer, create: answer } });
  return method;
}

describe('ошибки passkey вместо текста браузера (#746)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('закрытое окно, истёкшее время или чужой браузер — PasskeyCancelledError', async () => {
    browserAnswers('get', () =>
      Promise.reject(
        new DOMException(
          'The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.',
          'NotAllowedError'
        )
      )
    );

    await expect(evaluatePasskeySlots([SLOT])).rejects.toBeInstanceOf(PasskeyCancelledError);
  });

  it('пустой ответ браузера — тоже отмена', async () => {
    browserAnswers('get', () => Promise.resolve(null));

    await expect(evaluatePasskeySlots([SLOT])).rejects.toBeInstanceOf(PasskeyCancelledError);
  });

  it('неподходящий адрес страницы — PasskeyNotAllowedHereError', async () => {
    browserAnswers('create', () =>
      Promise.reject(new DOMException('The RP ID is invalid', 'SecurityError'))
    );

    await expect(
      registerPasskey({ id: 'user-1', username: 'anna', displayName: 'Анна' })
    ).rejects.toBeInstanceOf(PasskeyNotAllowedHereError);
  });

  it('прочие ошибки проходят как есть', async () => {
    const failure = new TypeError('сбой');
    browserAnswers('get', () => Promise.reject(failure));

    await expect(evaluatePasskeySlots([SLOT])).rejects.toBe(failure);
  });
});

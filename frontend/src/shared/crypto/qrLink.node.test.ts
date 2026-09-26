import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from './encoding';
import {
  forgetLoginPassword,
  matchesLoginPassword,
  rememberLoginPassword,
} from './loginPasswordFingerprint';
import {
  buildQrLink,
  createQrReceiver,
  parseQrFragment,
  parseQrLink,
  sealForQrReceiver,
} from './qrLink';

const TOKEN = '0123456789abcdef0123456789abcdef';

describe('QR: ссылка', () => {
  it('кладёт токен и ключ во фрагмент, который не уходит на сервер', async () => {
    const { publicKey } = await createQrReceiver();

    const link = buildQrLink('https://web.craneapp.ru/', { token: TOKEN, publicKey });
    const url = new URL(link);

    expect(url.pathname).toBe('/link');
    expect(url.search).toBe('');
    expect(parseQrLink(link)).toEqual({ token: TOKEN, publicKey });
  });

  it('разбирает фрагмент открытой страницы', async () => {
    const { publicKey } = await createQrReceiver();
    const hash = new URL(buildQrLink('http://localhost:3000', { token: TOKEN, publicKey })).hash;

    expect(parseQrFragment(hash)).toEqual({ token: TOKEN, publicKey });
  });

  it('не принимает чужие ссылки и мусор', async () => {
    const { publicKey } = await createQrReceiver();

    expect(parseQrLink('просто текст')).toBeNull();
    expect(parseQrLink(`https://evil.example/other#t=${TOKEN}&k=${publicKey}`)).toBeNull();
    expect(
      parseQrLink(`https://evil.example/link#t=${TOKEN}&k=${publicKey}`, 'https://web.craneapp.ru')
    ).toBeNull();
    expect(parseQrLink(`https://web.craneapp.ru/link#t=short&k=${publicKey}`)).toBeNull();
  });
});

describe('QR: передача мастер-ключа', () => {
  it('новое устройство расшифровывает то, что зашифровало вошедшее', async () => {
    const receiver = await createQrReceiver();
    const master = crypto.getRandomValues(new Uint8Array(32));

    const payload = await sealForQrReceiver(
      { token: TOKEN, publicKey: receiver.publicKey },
      master
    );

    expect(bytesToBase64(await receiver.open(payload, TOKEN))).toBe(bytesToBase64(master));
  });

  it('шифровка привязана к токену входа', async () => {
    const receiver = await createQrReceiver();
    const payload = await sealForQrReceiver(
      { token: TOKEN, publicKey: receiver.publicKey },
      new Uint8Array(32)
    );

    await expect(receiver.open(payload, 'ffffffffffffffffffffffffffffffff')).rejects.toThrow();
  });

  it('другое устройство с чужим ключом прочитать не может', async () => {
    const receiver = await createQrReceiver();
    const stranger = await createQrReceiver();
    const payload = await sealForQrReceiver(
      { token: TOKEN, publicKey: receiver.publicKey },
      new Uint8Array(32)
    );

    await expect(stranger.open(payload, TOKEN)).rejects.toThrow();
  });
});

describe('облачный пароль и пароль входа', () => {
  it('узнаёт совпадение с только что введённым паролем входа', async () => {
    await rememberLoginPassword('Пароль-входа-1');

    expect(await matchesLoginPassword('Пароль-входа-1')).toBe(true);
    expect(await matchesLoginPassword('другой облачный пароль')).toBe(false);

    forgetLoginPassword();
    expect(await matchesLoginPassword('Пароль-входа-1')).toBe(false);
  });
});

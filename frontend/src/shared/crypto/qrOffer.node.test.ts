import { describe, expect, it } from 'vitest';
import {
  buildQrOfferLink,
  createQrClaim,
  createQrOffer,
  parseQrOfferFragment,
  parseQrOfferLink,
} from './qrOffer';

const TOKEN = '0123456789abcdef0123456789abcdef';

async function offerLink() {
  const offer = await createQrOffer();
  const link = { token: TOKEN, publicKey: offer.publicKey, macKey: offer.macKey };
  return { offer, link };
}

describe('QR с вошедшего устройства: ссылка (#754)', () => {
  it('кладёт токен, ключ и ключ подписи во фрагмент, который не уходит на сервер', async () => {
    const { link } = await offerLink();

    const url = new URL(buildQrOfferLink('https://web.craneapp.ru/', link));

    expect(url.pathname).toBe('/qr-login');
    expect(url.search).toBe('');
    expect(parseQrOfferLink(url.href)).toEqual(link);
    expect(parseQrOfferFragment(url.hash)).toEqual(link);
  });

  it('не принимает чужие ссылки, код для другого направления и мусор', async () => {
    const { link } = await offerLink();
    const valid = buildQrOfferLink('https://web.craneapp.ru', link);

    expect(parseQrOfferLink(valid, 'https://evil.example')).toBeNull();
    expect(parseQrOfferLink(valid.replace('/qr-login', '/link'))).toBeNull();
    expect(parseQrOfferLink(valid.replace(/&s=[^&]+/, ''))).toBeNull();
    expect(parseQrOfferLink('просто текст')).toBeNull();
  });
});

describe('QR с вошедшего устройства: передача ключа (#754)', () => {
  it('новое устройство получает мастер-ключ, и коды сверки на экранах совпадают', async () => {
    const { offer, link } = await offerLink();
    const claim = await createQrClaim(link);
    const master = crypto.getRandomValues(new Uint8Array(32));

    expect(await offer.verifyClaim(TOKEN, claim.publicKey, claim.mac)).toBe(true);
    const shown = await offer.verificationCode(TOKEN, claim.publicKey);
    expect(shown).toMatch(/^\d{4}$/);
    expect(await claim.verificationCode()).toBe(shown);

    const payload = await offer.seal(TOKEN, claim.publicKey, master);
    expect(await claim.open(payload)).toEqual(master);
  });

  it('ключ, подменённый без ключа подписи из кода, не проходит проверку', async () => {
    const { offer, link } = await offerLink();
    const genuine = await createQrClaim(link);
    // Сервер видит подпись настоящего устройства, но не ключ подписи.
    const forged = await createQrClaim({ ...link, macKey: 'A'.repeat(43) });

    expect(await offer.verifyClaim(TOKEN, forged.publicKey, forged.mac)).toBe(false);
    expect(await offer.verifyClaim(TOKEN, forged.publicKey, genuine.mac)).toBe(false);
    expect(await offer.verifyClaim(TOKEN, genuine.publicKey, 'не подпись')).toBe(false);
  });

  it('подпись привязана к коду: к другому токену её не переложить', async () => {
    const { offer, link } = await offerLink();
    const claim = await createQrClaim(link);

    expect(await offer.verifyClaim('f'.repeat(32), claim.publicKey, claim.mac)).toBe(false);
  });

  it('у того, кто отсканировал раньше, другие цифры', async () => {
    const { offer, link } = await offerLink();
    const thief = await createQrClaim(link);
    const shown = await offer.verificationCode(TOKEN, thief.publicKey);
    expect(await thief.verificationCode()).toBe(shown);

    // Случайно совпасть четыре цифры могут — один раз из 10 000. Три
    // попытки подряд не совпадут никогда, и тест не мигает.
    const owners = await Promise.all([1, 2, 3].map(() => createQrClaim(link)));
    const codes = await Promise.all(owners.map((owner) => owner.verificationCode()));
    expect(codes.some((code) => code !== shown)).toBe(true);
  });

  it('новое устройство не принимает шифровку от чужого ключа', async () => {
    const { link } = await offerLink();
    const claim = await createQrClaim(link);
    const impostor = await createQrOffer();

    const payload = await impostor.seal(TOKEN, claim.publicKey, new Uint8Array(32));

    await expect(claim.open(payload)).rejects.toThrow();
  });
});

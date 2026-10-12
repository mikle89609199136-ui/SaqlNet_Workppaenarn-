import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQrOffer, type IQrOffer, type IQrOfferLink, type IQrPayload } from '@/shared/crypto';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { IQrLoginResult } from '../model/useQrLogin';
import { QrClaimPanel } from './QrClaimPanel';

const TOKEN = '0123456789abcdef0123456789abcdef';

async function shownOffer(): Promise<{ offer: IQrOffer; link: IQrOfferLink }> {
  const offer = await createQrOffer();
  return { offer, link: { token: TOKEN, publicKey: offer.publicKey, macKey: offer.macKey } };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderPanel(link: IQrOfferLink, onConfirmed = vi.fn(async (_: IQrLoginResult) => {})) {
  const onRetry = vi.fn();
  render(
    <I18nextProvider i18n={testI18n}>
      <QrClaimPanel link={link} onConfirmed={onConfirmed} onRetry={onRetry} />
    </I18nextProvider>
  );
  return { onConfirmed, onRetry };
}

describe('новое устройство входит по коду с вошедшего (#754)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('показывает те же цифры, что у вошедшего, и входит с мастер-ключом после подтверждения', async () => {
    const { offer, link } = await shownOffer();
    const master = crypto.getRandomValues(new Uint8Array(32));
    let claimed: { publicKey: string; mac: string } | null = null;
    let payload: IQrPayload | null = null;
    let polledWith: string | null = null;

    server.use(
      http.post(api(`/auth/qr-offer/${TOKEN}/claim`), async ({ request }) => {
        claimed = (await request.json()) as { publicKey: string; mac: string };
        return HttpResponse.json({ claimSecret: 'claim-secret', expiresAt: Date.now() + 60_000 });
      }),
      http.get(api(`/auth/qr-offer/${TOKEN}/status`), ({ request }) => {
        polledWith = request.headers.get('X-QR-Secret');
        return HttpResponse.json(
          payload ? { status: 'confirmed', payload } : { status: 'pending' }
        );
      })
    );

    const { onConfirmed } = renderPanel(link);

    await vi.waitFor(() => expect(claimed).not.toBeNull());
    const claim = claimed as unknown as { publicKey: string; mac: string };
    // Ключ подписан ключом из кода — вошедшее устройство его примет.
    expect(await offer.verifyClaim(TOKEN, claim.publicKey, claim.mac)).toBe(true);
    expect(
      await screen.findByText(await offer.verificationCode(TOKEN, claim.publicKey))
    ).toBeInTheDocument();

    payload = await offer.seal(TOKEN, claim.publicKey, master);
    await advance(2000);

    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(polledWith).toBe('claim-secret');
    const result = onConfirmed.mock.calls[0][0];
    expect(result.masterKey).toEqual(master);
  });

  it('просит отсканировать ещё раз, если код успел смениться', async () => {
    const { link } = await shownOffer();
    server.use(
      http.post(api(`/auth/qr-offer/${TOKEN}/claim`), () =>
        HttpResponse.json({ code: 'qr_rotated' }, { status: 404 })
      )
    );

    renderPanel(link);

    expect(await screen.findByText('Код обновился — отсканируйте ещё раз.')).toBeInTheDocument();
  });

  it('предупреждает, если код уже отсканировал кто-то другой', async () => {
    const { link } = await shownOffer();
    server.use(
      http.post(api(`/auth/qr-offer/${TOKEN}/claim`), () =>
        HttpResponse.json({ code: 'invalid_token' }, { status: 404 })
      )
    );

    renderPanel(link);

    expect(await screen.findByText(/уже отсканировали/)).toBeInTheDocument();
  });

  it('сообщает об отказе, когда вошедшее устройство отклонило вход', async () => {
    const { link } = await shownOffer();
    server.use(
      http.post(api(`/auth/qr-offer/${TOKEN}/claim`), () =>
        HttpResponse.json({ claimSecret: 'claim-secret', expiresAt: Date.now() + 60_000 })
      ),
      http.get(api(`/auth/qr-offer/${TOKEN}/status`), () =>
        HttpResponse.json({ status: 'expired' })
      )
    );

    const { onConfirmed } = renderPanel(link);
    await screen.findByText('Код сверки');
    await advance(2000);

    expect(await screen.findByText(/Вход не подтвердили/)).toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});

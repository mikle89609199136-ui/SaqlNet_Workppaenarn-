import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import {
  createQrClaim,
  forgetBackupState,
  parseQrOfferLink,
  setBackupState,
  type IQrClaim,
} from '@/shared/crypto';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { QrOfferPanel } from './QrOfferPanel';

const PAYLOAD = { senderPublicKey: 'c2VuZGVy', iv: 'aXY=', ct: 'Y3Q=' };

/** Сервер кодов: выдаёт их по порядку, по запросу — отсканированными. */
function offerServer() {
  const created: { replaces?: string }[] = [];
  const withdrawn: string[] = [];
  const confirmed: unknown[] = [];
  let claim: { publicKey: string; mac: string } | null = null;

  server.use(
    http.post(api('/auth/qr-offer'), async ({ request }) => {
      created.push((await request.json()) as { replaces?: string });
      return HttpResponse.json({
        offerToken: String(created.length).repeat(32),
        expiresAt: Date.now() + 60_000,
      });
    }),
    http.get(api('/auth/qr-offer/:token'), () =>
      HttpResponse.json(
        claim
          ? {
              status: 'claimed',
              claim: { ...claim, deviceName: 'iPhone', userAgent: 'Safari', claimedAt: Date.now() },
            }
          : { status: 'pending' }
      )
    ),
    http.delete(api('/auth/qr-offer/:token'), ({ params }) => {
      withdrawn.push(String(params.token));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(api('/auth/qr-offer/:token/confirm'), async ({ request }) => {
      confirmed.push(await request.json());
      return HttpResponse.json({ success: true });
    })
  );

  return {
    created,
    withdrawn,
    confirmed,
    claimWith: (value: { publicKey: string; mac: string }) => {
      claim = value;
    },
  };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Ссылка из кода — такая, какую прочтёт камера нового устройства. */
async function scanShownCode() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(await screen.findByRole('button', { name: 'Скопировать ссылку' }));
  const link = parseQrOfferLink(await navigator.clipboard.readText());
  if (!link) throw new Error('в коде не ссылка для входа');
  return { link, claim: await createQrClaim(link) };
}

function renderPanel() {
  return render(
    <I18nextProvider i18n={testI18n}>
      <QrOfferPanel />
    </I18nextProvider>
  );
}

describe('код для входа на вошедшем устройстве (#754)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setBackupState({ status: 'ready', hasPasskey: false, migrating: false });
    /* Мастер-ключа в тесте нет: передача ключа проверена в
       qrOffer.node.test.ts, здесь — поведение экрана. */
    vi.spyOn(services.cryptoService, 'sealMasterKeyForOffer').mockResolvedValue(PAYLOAD);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    forgetBackupState();
  });

  it('показывает цифры сверки и впускает только после подтверждения', async () => {
    const offers = offerServer();
    renderPanel();
    const { claim } = await scanShownCode();

    offers.claimWith(claim);
    await advance(2000);

    expect(await screen.findByText('iPhone')).toBeInTheDocument();
    expect(screen.getByLabelText('Код сверки')).toHaveTextContent(await claim.verificationCode());
    expect(offers.confirmed).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Цифры совпадают — впустить' }));

    expect(await screen.findByText(/новое устройство вошло/)).toBeInTheDocument();
    expect(offers.confirmed).toEqual([{ payload: PAYLOAD }]);
    expect(services.cryptoService.sealMasterKeyForOffer).toHaveBeenCalledWith(
      expect.anything(),
      '1'.repeat(32),
      claim.publicKey
    );
  });

  it('не спрашивает человека, если ключ подписан не ключом из кода', async () => {
    const offers = offerServer();
    renderPanel();
    const { link } = await scanShownCode();
    // Так выглядит подмена сервером: ключ свой, а ключа подписи он не знает.
    const forged: IQrClaim = await createQrClaim({ ...link, macKey: 'A'.repeat(43) });

    offers.claimWith(forged);
    await advance(2000);

    expect(await screen.findByText(/код мог быть подменён/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /впустить/ })).not.toBeInTheDocument();
    expect(offers.withdrawn).toContain('1'.repeat(32));
    await vi.waitFor(() => expect(offers.created).toHaveLength(2));
  });

  it('«Отклонить» гасит код и показывает новый', async () => {
    const offers = offerServer();
    renderPanel();
    const { claim } = await scanShownCode();
    offers.claimWith(claim);
    await advance(2000);

    await userEvent.click(await screen.findByRole('button', { name: 'Отклонить' }));

    await vi.waitFor(() => expect(offers.withdrawn).toContain('1'.repeat(32)));
    await vi.waitFor(() => expect(offers.created).toHaveLength(2));
    expect(offers.confirmed).toEqual([]);
  });

  it('каждые 30 секунд меняет код, пока его не отсканировали', async () => {
    const offers = offerServer();
    renderPanel();
    await screen.findByRole('img', { name: 'QR-код для входа на новом устройстве' });

    await advance(30_000);

    await vi.waitFor(() => expect(offers.created).toEqual([{}, { replaces: '1'.repeat(32) }]));
  });

  it('без открытой копии код не показывает вовсе', () => {
    setBackupState({ status: 'locked', hasPasskey: false, migrating: false });
    const offers = offerServer();

    renderPanel();

    expect(screen.getByText(/резервная копия ещё не открыта/)).toBeInTheDocument();
    expect(offers.created).toEqual([]);
  });
});

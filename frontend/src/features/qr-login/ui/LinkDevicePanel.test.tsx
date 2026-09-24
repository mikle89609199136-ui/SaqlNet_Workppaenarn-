import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { forgetBackupState, setBackupState } from '@/shared/crypto';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { LinkDevicePanel } from './LinkDevicePanel';

const TOKEN = '0123456789abcdef0123456789abcdef';
const KEY = 'A'.repeat(122);
const LINK = `${window.location.origin}/link#t=${TOKEN}&k=${KEY}`;

function renderPanel(initialLink: string | null = LINK) {
  render(
    <I18nextProvider i18n={testI18n}>
      <LinkDevicePanel initialLink={initialLink} />
    </I18nextProvider>
  );
}

function answerRequest(publicKey: string) {
  server.use(
    http.get(api(`/auth/qr-request/${TOKEN}`), () =>
      HttpResponse.json({
        publicKey,
        deviceName: 'Firefox на Linux',
        userAgent: 'Mozilla/5.0',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      })
    )
  );
}

describe('подключение устройства по QR (#745)', () => {
  beforeEach(() => {
    setBackupState({ status: 'ready', hasPasskey: false, migrating: false });
    /* Шифрование подменено методом сервиса: здесь проверяется поведение
       экрана, а сама передача ключа — в qrLink.node.test.ts. */
    vi.spyOn(services.cryptoService, 'sealMasterKeyForLink').mockResolvedValue({
      senderPublicKey: 'c2VuZGVy',
      iv: 'aXY=',
      ct: 'Y3Q=',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    forgetBackupState();
  });

  it('показывает, какое устройство входит, и предупреждает о чужих просьбах', async () => {
    answerRequest(KEY);

    renderPanel();

    expect(await screen.findByText('Firefox на Linux')).toBeInTheDocument();
    expect(screen.getByText(/Никогда не сканируйте код по чужой просьбе/)).toBeInTheDocument();
  });

  it('отказывается, если ключ в коде не совпадает с запросом входа', async () => {
    answerRequest('B'.repeat(122));

    renderPanel();

    expect(await screen.findByText(/не подтверждайте его/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Подтвердить вход' })).not.toBeInTheDocument();
  });

  it('передаёт ключ только после подтверждения человеком', async () => {
    answerRequest(KEY);
    let confirmed: unknown = null;
    server.use(
      http.post(api('/auth/qr-confirm'), async ({ request }) => {
        confirmed = await request.json();
        return HttpResponse.json({ success: true });
      })
    );

    renderPanel();
    await screen.findByText('Firefox на Linux');
    expect(confirmed).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить вход' }));

    expect(await screen.findByText(/новое устройство вошло/)).toBeInTheDocument();
    expect(confirmed).toEqual({
      qrToken: TOKEN,
      payload: { senderPublicKey: 'c2VuZGVy', iv: 'aXY=', ct: 'Y3Q=' },
    });
  });

  it('не принимает ссылку с чужого сайта', async () => {
    renderPanel(null);

    await userEvent.type(
      screen.getByLabelText('Или вставьте ссылку из-под кода'),
      `https://evil.example/link#t=${TOKEN}&k=${KEY}`
    );
    await userEvent.click(screen.getByRole('button', { name: 'Проверить' }));

    expect(await screen.findByText('Это не код входа в CraneApp')).toBeInTheDocument();
  });

  it('не даёт подключать устройства, пока копия здесь не открыта', () => {
    setBackupState({ status: 'locked', hasPasskey: false, migrating: false });

    renderPanel(null);

    expect(screen.getByText(/резервная копия ещё не открыта/)).toBeInTheDocument();
  });
});

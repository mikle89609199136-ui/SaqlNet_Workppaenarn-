import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { QR_ROTATE_MS } from '../model/useQrLogin';
import { QrLoginPanel } from './QrLoginPanel';

interface ICreated {
  replaces?: string;
  secret?: string;
}

/** Сервер кодов: выдаёт их по порядку и запоминает, что у него спрашивали. */
function codeServer() {
  const created: ICreated[] = [];
  const polled: { token: string; secret: string | null }[] = [];
  const cancelled: { token: string; secret?: string }[] = [];
  let status = 'pending';

  server.use(
    http.post(api('/auth/qr-token'), async ({ request }) => {
      created.push((await request.json()) as ICreated);
      const n = created.length;
      return HttpResponse.json({
        qrToken: String(n).repeat(32),
        secret: `secret-${n}`,
        expiresAt: Date.now() + 60_000,
      });
    }),
    http.get(api('/auth/qr-status/:token'), ({ params, request }) => {
      polled.push({ token: String(params.token), secret: request.headers.get('X-QR-Secret') });
      return HttpResponse.json({ status });
    }),
    http.delete(api('/auth/qr-token/:token'), async ({ params, request }) => {
      cancelled.push({
        token: String(params.token),
        ...((await request.json()) as { secret?: string }),
      });
      return new HttpResponse(null, { status: 204 });
    })
  );

  return {
    created,
    polled,
    cancelled,
    setStatus: (value: string) => {
      status = value;
    },
  };
}

function renderPanel() {
  return render(
    <I18nextProvider i18n={testI18n}>
      <QrLoginPanel onConfirmed={async () => {}} />
    </I18nextProvider>
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('код входа на новом устройстве меняется и гаснет (#753)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('каждые 30 секунд показывает новый код, заменяя прежний его секретом', async () => {
    const codes = codeServer();
    renderPanel();

    expect(await screen.findByRole('img', { name: 'QR-код для входа' })).toBeInTheDocument();
    expect(codes.created).toHaveLength(1);
    expect(codes.created[0].replaces).toBeUndefined();

    await advance(QR_ROTATE_MS);
    await vi.waitFor(() => expect(codes.created).toHaveLength(2));

    expect(codes.created[1]).toMatchObject({ replaces: '1'.repeat(32), secret: 'secret-1' });
    // Спрашиваем о новом коде и с новым секретом.
    await advance(2000);
    expect(codes.polled.at(-1)).toEqual({ token: '2'.repeat(32), secret: 'secret-2' });
  });

  it('отсканированный код больше не меняется и просит подтвердить на другом устройстве', async () => {
    const codes = codeServer();
    renderPanel();
    await screen.findByRole('img', { name: 'QR-код для входа' });

    codes.setStatus('scanned');
    await advance(2000);

    expect(await screen.findByText(/Подтвердите вход на устройстве/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'QR-код для входа' })).not.toBeInTheDocument();

    await advance(QR_ROTATE_MS * 2);
    expect(codes.created).toHaveLength(1);
  });

  it('завершает вход по cookie без токена в ответе', async () => {
    const codes = codeServer();
    const onConfirmed = vi.fn(async () => {});
    render(
      <I18nextProvider i18n={testI18n}>
        <QrLoginPanel onConfirmed={onConfirmed} />
      </I18nextProvider>
    );
    await screen.findByRole('img', { name: 'QR-код для входа' });

    codes.setStatus('confirmed');
    await advance(2000);

    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledWith({ masterKey: null }));
  });

  it('уходя со страницы, гасит показанный код', async () => {
    const codes = codeServer();
    const view = renderPanel();
    await screen.findByRole('img', { name: 'QR-код для входа' });

    view.unmount();

    await vi.waitFor(() =>
      expect(codes.cancelled).toEqual([{ token: '1'.repeat(32), secret: 'secret-1' }])
    );
  });
});

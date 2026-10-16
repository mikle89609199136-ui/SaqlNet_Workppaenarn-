import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderSettings } from '@/test/harness/renderSettings';

describe('NotificationsSection — тумблер звуков звонков (#1002)', () => {
  it('отображает тумблер «Звуки звонков» со значением по умолчанию (включён)', async () => {
    // В профиле нет поля callSounds — должно подставиться true по умолчанию
    renderSettings({
      section: 'notifications',
      settings: { notifications: true, sounds: true },
    });

    const callSoundsSwitch = await screen.findByRole('switch', { name: 'Звуки звонков' });
    expect(callSoundsSwitch).toBeInTheDocument();
    expect(callSoundsSwitch).toBeChecked();
    expect(screen.getByText('Рингтон при входящем аудио- или видеозвонке')).toBeInTheDocument();
  });

  it('отображает отключённый тумблер, если в настройках callSounds: false', async () => {
    renderSettings({
      section: 'notifications',
      settings: { notifications: true, sounds: true, callSounds: false },
    });

    const callSoundsSwitch = await screen.findByRole('switch', { name: 'Звуки звонков' });
    expect(callSoundsSwitch).not.toBeChecked();
  });

  it('отправляет { callSounds: false } на сервер при выключении тумблера', async () => {
    let sent: unknown;
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ settings: sent });
      })
    );

    renderSettings({
      section: 'notifications',
      settings: { notifications: true, sounds: true, callSounds: true },
    });

    const callSoundsSwitch = await screen.findByRole('switch', { name: 'Звуки звонков' });
    await userEvent.click(callSoundsSwitch);

    await waitFor(() => expect(sent).toEqual({ callSounds: false }));
  });

  it('отправляет { callSounds: true } на сервер при повторном включении', async () => {
    let sent: unknown;
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ settings: sent });
      })
    );

    renderSettings({
      section: 'notifications',
      settings: { notifications: true, sounds: true, callSounds: false },
    });

    const callSoundsSwitch = await screen.findByRole('switch', { name: 'Звуки звонков' });
    await userEvent.click(callSoundsSwitch);

    await waitFor(() => expect(sent).toEqual({ callSounds: true }));
  });

  it('клик по текстовой подписи переключает тумблер', async () => {
    let stored: Record<string, unknown> = { callSounds: true };
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        stored = { ...stored, ...(await request.json()) };
        return HttpResponse.json({ settings: stored });
      }),
      http.get(api('/users/settings'), () => HttpResponse.json({ settings: stored, privacy: {} }))
    );

    renderSettings({
      section: 'notifications',
      settings: { callSounds: true },
    });

    const label = await screen.findByText('Звуки звонков');
    await userEvent.click(label);

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Звуки звонков' })).not.toBeChecked()
    );
  });

  it('возвращает тумблер в прежнее состояние и показывает тост при ошибке сервера', async () => {
    server.use(
      http.put(api('/users/settings'), () => HttpResponse.json({}, { status: 500 })),
      http.get(api('/users/settings'), () =>
        HttpResponse.json({ settings: { callSounds: true }, privacy: {} })
      )
    );

    renderSettings({
      section: 'notifications',
      settings: { callSounds: true },
    });

    const callSoundsSwitch = await screen.findByRole('switch', { name: 'Звуки звонков' });
    await userEvent.click(callSoundsSwitch);

    expect(await screen.findByText('Не удалось сохранить настройки')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Звуки звонков' })).toBeChecked()
    );
  });
});

describe('NotificationsSection — независимые предпочтения (#496)', () => {
  it('глобальное выключение и включение сохраняет выбранные sounds и callSounds', async () => {
    let stored = { notifications: true, sounds: false, callSounds: true };
    const patches: unknown[] = [];
    server.use(
      http.get(api('/users/settings'), () => HttpResponse.json({ settings: stored, privacy: {} })),
      http.put(api('/users/settings'), async ({ request }) => {
        const patch = await request.json();
        patches.push(patch);
        stored = { ...stored, ...(patch as Partial<typeof stored>) };
        return HttpResponse.json({ settings: stored });
      })
    );

    renderSettings({ section: 'notifications', settings: stored });
    const notifications = await screen.findByRole('switch', { name: 'Уведомления', exact: true });

    await userEvent.click(notifications);
    await waitFor(() => expect(notifications).not.toBeChecked());
    await waitFor(() => expect(patches).toEqual([{ notifications: false }]));
    expect(screen.getByRole('switch', { name: 'Звуки сообщений' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Звуки звонков' })).toBeChecked();

    await userEvent.click(notifications);
    await waitFor(() => expect(notifications).toBeChecked());
    await waitFor(() =>
      expect(patches).toEqual([{ notifications: false }, { notifications: true }])
    );
    expect(screen.getByRole('switch', { name: 'Звуки сообщений' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Звуки звонков' })).toBeChecked();
  });
});

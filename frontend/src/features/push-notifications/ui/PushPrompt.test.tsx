import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { usePushStore, type TPushStatus } from '../model/pushNotifications';
import { PushPrompt } from './PushPrompt';
import { PushSettingItem } from './PushSettingItem';

// Действия — параметрами компонентов: vi.mock при isolate:false ненадёжен.
const enablePush = vi.fn(async () => undefined);
const disablePush = vi.fn(async () => undefined);

const permission = (value: NotificationPermission) =>
  Object.defineProperty(Notification, 'permission', { value, configurable: true });

function renderWith(ui: React.ReactElement, status: TPushStatus) {
  usePushStore.setState({ status, subscriptionId: null, busy: false });
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

beforeEach(() => {
  localStorage.removeItem('craneapp_push_prompt_dismissed');
  enablePush.mockReset();
  disablePush.mockReset();
  permission('default');
});
afterEach(() => permission('granted'));

/* Плашка «Включить уведомления» в списке чатов (#882). */
describe('плашка push', () => {
  it('не включали и не спрашивали — предлагает включить, по нажатию', () => {
    renderWith(<PushPrompt enable={enablePush} />, 'off');

    fireEvent.click(screen.getByRole('button', { name: 'Включить' }));
    expect(enablePush).toHaveBeenCalledTimes(1);
  });

  it('закрыли — больше не появляется', () => {
    const { unmount } = renderWith(<PushPrompt />, 'off');
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }));
    expect(screen.queryByRole('button', { name: 'Включить' })).toBeNull();
    unmount();

    renderWith(<PushPrompt />, 'off');
    expect(screen.queryByRole('button', { name: 'Включить' })).toBeNull();
  });

  it('iPhone вне установленного приложения — подсказка, как установить', () => {
    renderWith(<PushPrompt />, 'needs-install');

    expect(screen.getByText(/На экран «Домой»/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Включить' })).toBeNull();
  });

  it('уже включено, запрещено или разрешение уже спрашивали — молчит', () => {
    for (const status of ['on', 'denied', 'unsupported', 'unavailable'] as TPushStatus[]) {
      const { container, unmount } = renderWith(<PushPrompt />, status);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    permission('granted');
    const { container } = renderWith(<PushPrompt />, 'off');
    expect(container).toBeEmptyDOMElement();
  });
});

/* Переключатель в «Уведомлениях и звуках» (#882). */
describe('переключатель push', () => {
  const toggle = () => screen.getByRole('switch', { name: /На этом устройстве/ });

  it('выключено — включает, включено — выключает', () => {
    const { unmount } = renderWith(
      <PushSettingItem disable={disablePush} enable={enablePush} />,
      'off'
    );
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle());
    expect(enablePush).toHaveBeenCalled();
    unmount();

    renderWith(<PushSettingItem disable={disablePush} enable={enablePush} />, 'on');
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle());
    expect(disablePush).toHaveBeenCalled();
  });

  it('недоступно — переключатель неактивен и объясняет почему', () => {
    const cases: [TPushStatus, RegExp][] = [
      ['denied', /Запрещены в настройках браузера/],
      ['needs-install', /После установки|после установки/],
      ['unsupported', /не поддерживает/],
      ['unavailable', /Сервер пока не отправляет/],
    ];
    for (const [status, hint] of cases) {
      const { unmount } = renderWith(<PushSettingItem />, status);
      expect(toggle()).toBeDisabled();
      expect(screen.getByText(hint)).toBeInTheDocument();
      unmount();
    }
  });
});

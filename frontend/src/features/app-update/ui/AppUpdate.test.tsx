import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { WS_EVENTS } from '@/shared/config';
import { eventBus } from '@/shared/lib/event-bus';
import { resetAppUpdate, useAppUpdateStore } from '../model/appUpdate';
import { useAppUpdateWatcher } from '../model/useAppUpdateWatcher';
import { AppUpdateBanner } from './AppUpdateBanner';
import { AppUpdateSettingItem } from './AppUpdateSettingItem';

// Действия — параметрами компонентов: vi.mock при isolate:false ненадёжен.
const request = vi.fn();
const NEW = { version: '0.10.0', build: 'new' };

const renderUi = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);

beforeEach(() => {
  resetAppUpdate();
  request.mockReset();
});

/* Плашка «Новая версия» над списком чатов (#892). */
describe('плашка обновления', () => {
  it('новой сборки нет — плашки нет', () => {
    const { container } = renderUi(<AppUpdateBanner request={request} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('есть — номер версии и «Обновить»; нечего терять — сразу', () => {
    useAppUpdateStore.setState({ remote: NEW });
    renderUi(<AppUpdateBanner losesUnsavedWork={() => false} request={request} />);

    expect(screen.getByText(/0\.10\.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('есть черновик или неотправленное — сначала спрашивает', () => {
    useAppUpdateStore.setState({ remote: NEW });
    renderUi(<AppUpdateBanner losesUnsavedWork={() => true} request={request} />);

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText(/пропадут/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Обновить' }).at(-1)!);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('ждёт конца звонка — говорит об этом, кнопка неактивна', () => {
    useAppUpdateStore.setState({ remote: NEW, requested: true, waitingFor: 'call' });
    renderUi(<AppUpdateBanner request={request} />);
    expect(screen.getByRole('button', { name: 'Обновится после звонка' })).toBeDisabled();
  });

  it('«Не сейчас» — до следующей новой сборки', () => {
    useAppUpdateStore.setState({ remote: NEW });
    const { container } = renderUi(<AppUpdateBanner request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }));
    expect(container).toBeEmptyDOMElement();

    act(() => useAppUpdateStore.setState({ remote: { version: '0.11.0', build: 'newer' } }));
    expect(screen.getByText(/0\.11\.0/)).toBeInTheDocument();
  });
});

/* «Обновления» в «О приложении». */
describe('строка «Обновления»', () => {
  it('«Проверить» — проверка; итог словами', () => {
    const check = vi.fn();
    const { rerender } = renderUi(<AppUpdateSettingItem check={check} request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(check).toHaveBeenCalledTimes(1);

    act(() => useAppUpdateStore.setState({ lastCheck: 'latest' }));
    rerender(
      <I18nextProvider i18n={testI18n}>
        <AppUpdateSettingItem check={check} request={request} />
      </I18nextProvider>
    );
    expect(screen.getByText('Установлена последняя версия')).toBeInTheDocument();
  });

  it('новая сборка есть — «Обновить» и её номер', () => {
    useAppUpdateStore.setState({ remote: NEW });
    renderUi(<AppUpdateSettingItem losesUnsavedWork={() => false} request={request} />);
    expect(screen.getByText('Доступна версия 0.10.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(request).toHaveBeenCalledTimes(1);
  });
});

/* Когда приложение проверяет само. */
describe('проверка по событиям', () => {
  it('при запуске, при возврате в приложение и при переподключении сокета', () => {
    const check = vi.fn();
    let visibility: DocumentVisibilityState = 'visible';
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const { unmount } = renderHook(() => useAppUpdateWatcher(check));
    expect(check).toHaveBeenCalledTimes(1);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(check).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(check).toHaveBeenCalledTimes(2);

    eventBus.emit(WS_EVENTS.SOCKET.CONNECTED, undefined);
    expect(check).toHaveBeenCalledTimes(3);

    unmount();
    eventBus.emit(WS_EVENTS.SOCKET.CONNECTED, undefined);
    expect(check).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import * as translatorConsent from '@/services/translatorConsent';
import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { TranslatorConsentDialog } from './TranslatorConsentDialog';

describe('TranslatorConsentDialog (#1085)', () => {
  beforeEach(() => {
    useChatUiStore.getState().resetChatState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('не рендерится при отсутствии запроса', () => {
    const onConfirm = vi.fn();
    render(
      <I18nextProvider i18n={testI18n}>
        <TranslatorConsentDialog onConfirm={onConfirm} />
      </I18nextProvider>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('рендерит модальное окно согласия и вызывает onConfirm при подтверждении', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const rememberSpy = vi.spyOn(translatorConsent, 'rememberTranslatorConsent');
    const msg = makeMessage({ id: 'msg-1', content: 'hello' });

    act(() => {
      useChatUiStore.getState().setTranslatorConsentRequest({ targets: [msg] });
    });

    render(
      <I18nextProvider i18n={testI18n}>
        <TranslatorConsentDialog onConfirm={onConfirm} />
      </I18nextProvider>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Перевод сообщений')).toBeInTheDocument();
    expect(
      screen.getByText(/Текст сообщения будет отправлен в Google для перевода/)
    ).toBeInTheDocument();

    const continueBtn = screen.getByRole('button', { name: 'Продолжить' });
    await user.click(continueBtn);

    expect(rememberSpy).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith([msg]);
    expect(useChatUiStore.getState().translatorConsentRequest).toBeNull();
  });

  it('закрывается без вызова onConfirm при клике Отмена', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const msg = makeMessage({ id: 'msg-1', content: 'hello' });

    act(() => {
      useChatUiStore.getState().setTranslatorConsentRequest({ targets: [msg] });
    });

    render(
      <I18nextProvider i18n={testI18n}>
        <TranslatorConsentDialog onConfirm={onConfirm} />
      </I18nextProvider>
    );

    const cancelBtn = screen.getByRole('button', { name: 'Отмена' });
    await user.click(cancelBtn);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(useChatUiStore.getState().translatorConsentRequest).toBeNull();
  });
});

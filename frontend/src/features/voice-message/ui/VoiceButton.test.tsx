import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import type { IVoiceRecorderState, VoiceRecorder } from '../model/voiceRecorder';
import { VoiceButton } from './VoiceButton';

const recording = { blob: new Blob(['ogg']), meta: { durationMs: 2000, waveform: [1, 2] } };

function makeRecorder(status: IVoiceRecorderState['status'] = 'idle') {
  const state: IVoiceRecorderState = {
    status,
    elapsedMs: 0,
    levels: [],
    error: null,
    limitReached: false,
  };
  return {
    state,
    recorder: {
      start: vi.fn(async () => undefined),
      lock: vi.fn(),
      cancel: vi.fn(),
      finish: vi.fn(async () => recording),
      getState: vi.fn(() => state),
      preload: vi.fn(),
    } as unknown as VoiceRecorder & Record<string, ReturnType<typeof vi.fn>>,
  };
}

function renderButton(status: IVoiceRecorderState['status'] = 'idle') {
  const { recorder, state } = makeRecorder(status);
  const onRecorded = vi.fn();
  const onCancelProgress = vi.fn();
  const view = render(
    <I18nextProvider i18n={testI18n}>
      <VoiceButton
        onCancelProgress={onCancelProgress}
        onRecorded={onRecorded}
        recorder={recorder}
        state={state}
      />
    </I18nextProvider>
  );
  return { recorder, onRecorded, onCancelProgress, ...view };
}

const mic = () => screen.getByRole('button', { name: 'Записать голосовое' });
const press = (x = 100, y = 100) =>
  fireEvent.pointerDown(mic(), { button: 0, pointerId: 1, clientX: x, clientY: y });

let now = 1_000;
beforeEach(() => {
  now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.mocked(Date.now).mockRestore();
});

/* Жесты кнопки голосового по макету (#843). */
describe('кнопка голосового', () => {
  it('удержание — запись; отпустили — отправлено', async () => {
    const { recorder, onRecorded } = renderButton();
    press();
    expect(recorder.start).toHaveBeenCalledWith();

    now += 1500;
    fireEvent.pointerUp(mic(), { pointerId: 1, clientX: 100, clientY: 100 });

    await vi.waitFor(() => expect(onRecorded).toHaveBeenCalledWith(recording));
    expect(recorder.finish).toHaveBeenCalled();
  });

  it('щелчок — запись закрепляется, держать не нужно', () => {
    const { recorder } = renderButton();
    press();
    now += 100;
    fireEvent.pointerUp(mic(), { pointerId: 1, clientX: 100, clientY: 100 });

    expect(recorder.lock).toHaveBeenCalled();
    expect(recorder.finish).not.toHaveBeenCalled();
  });

  it('смахнули влево — отмена, подсказка растёт по пути', () => {
    const { recorder, onCancelProgress } = renderButton();
    press();
    fireEvent.pointerMove(mic(), { pointerId: 1, clientX: 52, clientY: 100 });
    expect(onCancelProgress).toHaveBeenLastCalledWith(0.5);

    fireEvent.pointerMove(mic(), { pointerId: 1, clientX: 0, clientY: 100 });
    expect(recorder.cancel).toHaveBeenCalled();
    expect(onCancelProgress).toHaveBeenLastCalledWith(0);
  });

  it('смахнули вверх — закреплено', () => {
    const { recorder } = renderButton();
    press();
    fireEvent.pointerMove(mic(), { pointerId: 1, clientX: 100, clientY: 20 });

    expect(recorder.lock).toHaveBeenCalled();
  });

  it('браузер забрал жест (pointercancel) — отмена, запись не висит', () => {
    const { recorder } = renderButton();
    press();
    fireEvent.pointerCancel(mic(), { pointerId: 1 });

    expect(recorder.cancel).toHaveBeenCalled();
  });

  it('клавиатура — сразу закреплённая запись', () => {
    const { recorder } = renderButton();
    fireEvent.click(mic(), { detail: 0 });

    expect(recorder.start).toHaveBeenCalledWith(true);
  });

  it('закреплённая запись — кнопка «Отправить голосовое», Esc — отмена', async () => {
    const { recorder, onRecorded } = renderButton('locked');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(recorder.cancel).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Отправить голосовое' }));
    await vi.waitFor(() => expect(onRecorded).toHaveBeenCalledWith(recording));
  });

  it('выключена, пока шифрование не готово: нажатия ничего не начинают', () => {
    const { recorder, state } = makeRecorder();
    render(
      <I18nextProvider i18n={testI18n}>
        <VoiceButton disabled onRecorded={vi.fn()} recorder={recorder} state={state} />
      </I18nextProvider>
    );

    expect(mic()).toBeDisabled();
    press();
    fireEvent.click(mic(), { detail: 0 });
    expect(recorder.start).not.toHaveBeenCalled();
  });

  it('наведение и фокус заранее грузят кодировщик и шумодав', () => {
    const { recorder } = renderButton();
    fireEvent.pointerEnter(mic());
    fireEvent.focus(mic());
    expect(recorder.preload).toHaveBeenCalledTimes(2);
  });

  it('правая кнопка и повторное нажатие во время записи ничего не начинают', () => {
    const { recorder } = renderButton();
    fireEvent.pointerDown(mic(), { button: 2, pointerId: 1, clientX: 1, clientY: 1 });
    expect(recorder.start).not.toHaveBeenCalled();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { AudioPlayer } from './AudioPlayer';

const renderPlayer = (props: React.ComponentProps<typeof AudioPlayer>) => {
  return render(
    <I18nextProvider i18n={testI18n}>
      <AudioPlayer {...props} />
    </I18nextProvider>
  );
};

describe('AudioPlayer', () => {
  beforeEach(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      get() {
        return this._paused ?? true;
      },
      set(v) {
        this._paused = v;
      },
      configurable: true,
    });
    window.HTMLMediaElement.prototype.play = vi.fn().mockImplementation(function (
      this: HTMLMediaElement
    ) {
      (this as any)._paused = false;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    window.HTMLMediaElement.prototype.pause = vi.fn().mockImplementation(function (
      this: HTMLMediaElement
    ) {
      (this as any)._paused = true;
      this.dispatchEvent(new Event('pause'));
    });
  });

  it('1. renders audio element with play button and time slider', () => {
    renderPlayer({ src: 'test.mp3' });
    expect(document.querySelector('audio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /воспроизвести/i })).toBeInTheDocument();
    expect(screen.getAllByRole('slider').length).toBeGreaterThanOrEqual(1);
  });

  it('2. toggles play/pause on button click', async () => {
    const user = userEvent.setup();
    renderPlayer({ src: 'test.mp3' });

    const playBtn = screen.getByRole('button', { name: /воспроизвести/i });
    await user.click(playBtn);
    expect(screen.getByRole('button', { name: /приостановить/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /приостановить/i }));
    expect(screen.getByRole('button', { name: /воспроизвести/i })).toBeInTheDocument();
  });

  it('3. displays formatted time after metadata loads', () => {
    renderPlayer({ src: 'test.mp3' });
    const audio = document.querySelector('audio')!;

    Object.defineProperty(audio, 'duration', { value: 125, configurable: true });
    fireEvent.loadedMetadata(audio);

    expect(screen.getByText('0:00 / 2:05')).toBeInTheDocument();
  });

  it('4. resets play state on ended', async () => {
    const user = userEvent.setup();
    renderPlayer({ src: 'test.mp3' });

    await user.click(screen.getByRole('button', { name: /воспроизвести/i }));
    expect(screen.getByRole('button', { name: /приостановить/i })).toBeInTheDocument();

    const audio = document.querySelector('audio')!;
    fireEvent.ended(audio);
    expect(screen.getByRole('button', { name: /воспроизвести/i })).toBeInTheDocument();
  });

  it('5. seeks to selected time when slider is changed', () => {
    renderPlayer({ src: 'test.mp3' });
    const audio = document.querySelector('audio')!;

    Object.defineProperty(audio, 'duration', { value: 100, configurable: true });
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true, configurable: true });
    fireEvent.loadedMetadata(audio);

    const slider = screen.getAllByRole('slider')[0];
    fireEvent.change(slider, { target: { value: '50' } });

    expect(audio.currentTime).toBe(50);
    expect(screen.getByText('0:50 / 1:40')).toBeInTheDocument();
  });

  it('6. renders mute button on desktop', () => {
    renderPlayer({ src: 'test.mp3' });
    expect(screen.getByRole('button', { name: /звук/i })).toBeInTheDocument();
  });

  it('7. toggles mute on button click', async () => {
    const user = userEvent.setup();
    renderPlayer({ src: 'test.mp3' });
    const audio = document.querySelector('audio')!;

    const muteBtn = screen.getByRole('button', { name: /звук/i });
    await user.click(muteBtn);
    expect(audio.muted).toBe(true);

    await user.click(screen.getByRole('button', { name: /звук/i }));
    expect(audio.muted).toBe(false);
  });

  it('8. volume slider exists in popup and changes volume', () => {
    renderPlayer({ src: 'test.mp3' });
    const audio = document.querySelector('audio')!;
    const sliders = screen.getAllByRole('slider');
    const volumeSlider = sliders[1];
    expect(volumeSlider).toBeInTheDocument();

    fireEvent.change(volumeSlider, { target: { value: '0.3' } });
    expect(audio.volume).toBeCloseTo(0.3);
  });

  /* Голосовое (#843): длительность и волна из шифрованных метаданных. */
  describe('голосовое', () => {
    it('показывает длительность из метаданных, даже если файл её не знает', () => {
      renderPlayer({ src: 'voice.ogg', variant: 'voice', durationMs: 83_000, waveform: [0, 31] });
      const audio = document.querySelector('audio')!;
      // У записи Ogg/Opus браузер часто отдаёт Infinity.
      Object.defineProperty(audio, 'duration', { value: Infinity, configurable: true });
      fireEvent.loadedMetadata(audio);

      expect(screen.getByText('1:23')).toBeInTheDocument();
      expect(screen.getByRole('slider', { name: 'Перемотка' })).toHaveAttribute('max', '83');
    });

    it('волна из метаданных: тихое — низкий столбик, громкое — высокий', () => {
      const { container } = renderPlayer({
        src: 'voice.ogg',
        variant: 'voice',
        durationMs: 5000,
        waveform: [0, 0, 31, 31],
      });
      const heights = [...container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')]
        .map((bar) => parseInt(bar.style.height, 10))
        .filter(Number.isFinite);

      expect(Math.min(...heights)).toBe(6);
      expect(Math.max(...heights)).toBe(25);
    });

    it('без метаданных и с Infinity у файла — не «NaN:NaN», а 0:00', () => {
      renderPlayer({ src: 'voice.ogg', variant: 'voice' });
      const audio = document.querySelector('audio')!;
      Object.defineProperty(audio, 'duration', { value: Infinity, configurable: true });
      fireEvent.loadedMetadata(audio);

      expect(screen.getByText('0:00')).toBeInTheDocument();
    });

    it('браузер не может проиграть — подпись и «Скачать», а не молчание', () => {
      renderPlayer({ src: 'blob:voice', variant: 'voice', durationMs: 3000 });
      fireEvent.error(document.querySelector('audio')!);

      expect(screen.getByText('Этот браузер не проигрывает голосовое')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Скачать' })).toHaveAttribute('href', 'blob:voice');
    });

    it('запуск второго голосового ставит первое на паузу', async () => {
      const user = userEvent.setup();
      render(
        <I18nextProvider i18n={testI18n}>
          <AudioPlayer seed="a" src="a.ogg" variant="voice" />
          <AudioPlayer seed="b" src="b.ogg" variant="voice" />
        </I18nextProvider>
      );
      const [first, second] = [...document.querySelectorAll('audio')];
      const [playFirst, playSecond] = screen.getAllByRole('button', {
        name: 'Прослушать голосовое',
      });

      await user.click(playFirst);
      expect(first.paused).toBe(false);
      await user.click(playSecond);

      expect(first.paused).toBe(true);
      expect(second.paused).toBe(false);
    });
  });
});

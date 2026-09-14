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
});

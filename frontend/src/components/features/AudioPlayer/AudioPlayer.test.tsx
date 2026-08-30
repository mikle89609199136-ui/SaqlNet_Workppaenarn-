import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioPlayer } from './AudioPlayer';

describe('AudioPlayer', () => {
  let playMock: ReturnType<typeof vi.spyOn>;
  let pauseMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      get() { return this._paused ?? true; },
      set(v) { this._paused = v; },
      configurable: true
    });

    playMock = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function(this: HTMLMediaElement) {
      Object.defineProperty(this, '_paused', { value: false, writable: true });
      return Promise.resolve();
    });
    pauseMock = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function(this: HTMLMediaElement) {
      Object.defineProperty(this, '_paused', { value: true, writable: true });
    });
    
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. renders audio element with correct src and initial controls', () => {
    render(<AudioPlayer src="test.mp3" />);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getByText('0:00 / 0:00')).toBeInTheDocument();
    expect(document.querySelector('audio')).toHaveAttribute('src', 'test.mp3');
  });

  it('2. toggles play state and calls media play/pause on button click', async () => {
    const user = userEvent.setup();
    render(<AudioPlayer src="test.mp3" />);
    
    const playBtn = screen.getByRole('button', { name: /play/i });
    await user.click(playBtn);
    expect(playMock).toHaveBeenCalledTimes(1);
    
    const pauseBtn = await screen.findByRole('button', { name: /pause/i });
    expect(pauseBtn).toBeInTheDocument();

    await user.click(pauseBtn);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('3. updates duration when metadata is loaded', () => {
    render(<AudioPlayer src="test.mp3" />);
    const audio = document.querySelector('audio')!;
    
    Object.defineProperty(audio, 'duration', { value: 125.5 });
    fireEvent.loadedMetadata(audio);
    
    expect(screen.getByText('0:00 / 2:05')).toBeInTheDocument();
  });

  it('4. resets to play state when audio ends', async () => {
    const user = userEvent.setup();
    render(<AudioPlayer src="test.mp3" />);
    
    const playBtn = screen.getByRole('button', { name: /play/i });
    await user.click(playBtn);
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument();
    
    const audio = document.querySelector('audio')!;
    fireEvent.ended(audio);
    
    expect(await screen.findByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('5. seeks to selected time when slider is changed', async () => {
    render(<AudioPlayer src="test.mp3" />);
    const audio = document.querySelector('audio')!;
    
    Object.defineProperty(audio, 'duration', { value: 100 });
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true });
    fireEvent.loadedMetadata(audio);

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '50' } });
    
    expect(audio.currentTime).toBe(50);
    expect(screen.getByText('0:50 / 1:40')).toBeInTheDocument();
  });
});

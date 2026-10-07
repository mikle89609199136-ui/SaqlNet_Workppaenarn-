import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getVoiceVolume } from '@/shared/lib';
import { renderSettings } from '@/test/harness/renderSettings';

describe('громкость голосовых в настройках (#874)', () => {
  it('в «Уведомлениях» — ползунок громкости голосовых этого устройства', async () => {
    renderSettings({ section: 'notifications', settings: { notifications: true, sounds: true } });

    const slider = await screen.findByRole('slider', { name: 'Громкость голосовых' });
    expect(screen.getByText('Только на этом устройстве')).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuetext', '100%');

    fireEvent.change(slider, { target: { value: '0.25' } });

    expect(getVoiceVolume()).toBe(0.25);
    expect(slider).toHaveAttribute('aria-valuetext', '25%');
    expect(screen.getByText('25%')).toBeInTheDocument();
  });
});

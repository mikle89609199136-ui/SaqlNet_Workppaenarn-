import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelsPage } from './ChannelsPage';

describe('ChannelsPage', () => {
  it('рендерит заглушку раздела каналов с заголовком и описанием', () => {
    render(<ChannelsPage />);

    expect(screen.getByRole('heading', { level: 1, name: /каналов пока нет/i })).toBeInTheDocument();
    expect(screen.getByText(/раздел ещё делается/i)).toBeInTheDocument();
  });
});

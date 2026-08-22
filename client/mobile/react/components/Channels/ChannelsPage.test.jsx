import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ChannelsPage } from './ChannelsPage.jsx';

describe('ChannelsPage', () => {
  it('renders the placeholder screen for the channels section', () => {
    render(
      <MemoryRouter>
        <ChannelsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /каналы/i })).toBeInTheDocument();
    expect(screen.getByText(/раздел в разработке/i)).toBeInTheDocument();
  });
});

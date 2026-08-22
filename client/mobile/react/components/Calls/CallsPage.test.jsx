import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CallsPage } from './CallsPage.jsx';

describe('CallsPage', () => {
  it('renders the placeholder screen for the calls section', () => {
    render(
      <MemoryRouter>
        <CallsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /звонки/i })).toBeInTheDocument();
    expect(screen.getByText(/раздел в разработке/i)).toBeInTheDocument();
  });
});

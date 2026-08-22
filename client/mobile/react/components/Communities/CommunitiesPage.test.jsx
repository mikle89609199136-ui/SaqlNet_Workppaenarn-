import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CommunitiesPage } from './CommunitiesPage.jsx';

describe('CommunitiesPage', () => {
  it('renders the placeholder screen for the communities section', () => {
    render(
      <MemoryRouter>
        <CommunitiesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /сообщества/i })).toBeInTheDocument();
    expect(screen.getByText(/раздел в разработке/i)).toBeInTheDocument();
  });
});

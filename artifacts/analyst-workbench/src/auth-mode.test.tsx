import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PkiApp from './PkiApp';

describe('PKI auth entry', () => {
  it('renders setup guidance without Clerk keys or a sign-in control', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no API in unit test')));
    render(<PkiApp />);
    expect(screen.getByText('Certificate sign-in not configured')).toBeTruthy();
    expect(screen.getByText(/No password, social sign-in, account registration/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('surfaces a PKI-build/API-Clerk runtime mismatch without an access control', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ mode: 'clerk', ready: true }),
    }));
    render(<PkiApp />);
    await waitFor(() => expect(screen.getByText(/configuration mismatch — access remains blocked/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
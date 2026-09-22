import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PkiApp from './PkiApp';
import ClerkEntry from './ClerkEntry';

vi.mock('./App', () => {
  throw new Error('Clerk application must not load for blocked deployment');
});

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

  it.each(['RESTRICTED_REQUIRES_PKI', 'DEPLOYMENT_PROFILE_INVALID'])(
    'shows blocked deployment reason %s without a Clerk fallback',
    async (reason) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ mode: 'clerk', ready: false, reason }),
      }));
      render(<PkiApp />);
      await waitFor(() => expect(screen.getByTestId('pki-auth-status').textContent).toContain(reason));
      expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
    },
  );

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(['RESTRICTED_REQUIRES_PKI', 'DEPLOYMENT_PROFILE_INVALID'])(
    'blocks the Clerk entry for %s without loading its provider',
    async (reason) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ mode: 'clerk', ready: false, reason }),
      }));
      render(<ClerkEntry />);
      await waitFor(() => expect(screen.getByText(new RegExp(reason))).toBeTruthy());
      expect(screen.getByText('No identity provider was initialized.')).toBeTruthy();
    },
  );
});
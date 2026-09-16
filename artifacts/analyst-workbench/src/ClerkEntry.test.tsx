import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const clerkAppModuleLoad = vi.hoisted(() => vi.fn());

vi.mock('./App', () => {
  clerkAppModuleLoad();
  return {
    default: () => <div data-testid="legacy-clerk-app">Legacy Clerk application</div>,
  };
});

import ClerkEntry from './ClerkEntry';

function readinessResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  };
}

describe('Clerk entry readiness gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clerkAppModuleLoad.mockClear();
  });

  it('blocks a stale Clerk build when the API is in PKI mode without loading Clerk', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(readinessResponse({
      mode: 'pki',
      ready: false,
      reason: 'PKI_NOT_CONFIGURED',
    })));
    render(<ClerkEntry />);
    await waitFor(() => expect(screen.getByText(/browser build expects Clerk, but the API reports pki/i)).toBeTruthy());
    expect(clerkAppModuleLoad).not.toHaveBeenCalled();
    expect(screen.queryByTestId('legacy-clerk-app')).toBeNull();
  });

  it('blocks loading on unavailable or malformed readiness responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(readinessResponse({ mode: 'clerk', ready: 'yes' })));
    render(<ClerkEntry />);
    await waitFor(() => expect(screen.getByText(/readiness could not be verified/i)).toBeTruthy());
    expect(clerkAppModuleLoad).not.toHaveBeenCalled();
  });

  it('blocks loading when the same-origin readiness request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    render(<ClerkEntry />);
    await waitFor(() => expect(screen.getByText(/readiness could not be verified/i)).toBeTruthy());
    expect(clerkAppModuleLoad).not.toHaveBeenCalled();
  });

  it('loads the legacy Clerk app only after the API confirms ready Clerk mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(readinessResponse({ mode: 'clerk', ready: true })));
    render(<ClerkEntry />);
    await waitFor(() => expect(screen.getByTestId('legacy-clerk-app')).toBeTruthy());
    expect(clerkAppModuleLoad).toHaveBeenCalledTimes(1);
  });
});
import { describe, expect, it } from 'vitest';

import { resolveAuthMode } from './auth-mode';

describe('auth mode policy', () => {
  it('defaults to the backward-compatible Clerk mode', () => {
    expect(resolveAuthMode({})).toBe('clerk');
  });

  it('accepts PKI only when the public mode agrees', () => {
    expect(resolveAuthMode({ AUTH_MODE: 'pki', VITE_AUTH_MODE: 'pki' })).toBe('pki');
  });

  it('fails closed for invalid or conflicting values', () => {
    expect(() => resolveAuthMode({ AUTH_MODE: 'unknown' })).toThrow(/AUTH_MODE/);
    expect(() => resolveAuthMode({ AUTH_MODE: 'pki', VITE_AUTH_MODE: 'clerk' })).toThrow(/match AUTH_MODE/);
  });
});
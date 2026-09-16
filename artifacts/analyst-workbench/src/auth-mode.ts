export type AuthMode = 'clerk' | 'pki';

export type AuthModeEnvironment = {
  AUTH_MODE?: string;
  VITE_AUTH_MODE?: string;
};

/**
 * Resolve the one browser/server auth mode used for a build.
 *
 * This module intentionally has no Vite or browser imports so its fail-closed
 * policy can be tested in any test environment.
 */
export function resolveAuthMode(env: AuthModeEnvironment): AuthMode {
  const configured = (env.AUTH_MODE ?? 'clerk').trim();
  const publicMode = env.VITE_AUTH_MODE?.trim();
  if (configured !== 'clerk' && configured !== 'pki') {
    throw new Error('AUTH_MODE must be exactly "clerk" or "pki".');
  }
  if (publicMode && publicMode !== configured) {
    throw new Error('VITE_AUTH_MODE must match AUTH_MODE; refusing an auth-mode mismatch.');
  }
  return configured;
}
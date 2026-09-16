export type AuthReadiness = {
  mode: 'clerk' | 'pki' | 'invalid';
  ready: boolean;
  reason?: 'CLERK_NOT_CONFIGURED' | 'PKI_NOT_CONFIGURED' | 'AUTH_MODE_INVALID';
};

function isAuthReadiness(value: unknown): value is AuthReadiness {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.mode === 'clerk' || candidate.mode === 'pki' || candidate.mode === 'invalid')
    && typeof candidate.ready === 'boolean'
    && (
      candidate.reason === undefined
      || candidate.reason === 'CLERK_NOT_CONFIGURED'
      || candidate.reason === 'PKI_NOT_CONFIGURED'
      || candidate.reason === 'AUTH_MODE_INVALID'
    )
  );
}

/**
 * Reads only the same-origin, public mode-readiness endpoint. It is never an
 * authentication request and validates the response before a caller can use
 * it to decide whether a provider module may load.
 */
export async function fetchAuthReadiness(basePath: string): Promise<AuthReadiness> {
  const response = await fetch(`${basePath}/api/auth-mode`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Auth readiness endpoint unavailable');
  const payload: unknown = await response.json();
  if (!isAuthReadiness(payload)) throw new Error('Auth readiness response is invalid');
  return payload;
}
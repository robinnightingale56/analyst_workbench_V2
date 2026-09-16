import { lazy, Suspense, useEffect, useState } from 'react';
import { fetchAuthReadiness, type AuthReadiness } from './auth-readiness';

// Keep the legacy provider in an isolated lazy chunk. The selected PKI entry
// never references this module, so no Clerk initialization is possible there.
const ClerkApp = lazy(() => import('./App'));

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function ClosedAuthScreen({ message }: { message: string }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[hsl(222_38%_15%)] px-6 text-white">
      <section className="max-w-xl border border-white/15 bg-white/5 p-7">
        <div className="mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(39_92%_72%)]">Access blocked</div>
        <h1 className="display mt-3 text-3xl font-bold">Authentication setup is required.</h1>
        <p className="mt-4 text-sm leading-6 text-white/70">{message}</p>
        <p className="mono mt-6 text-[10px] uppercase tracking-[0.12em] text-white/45">No identity provider was initialized.</p>
      </section>
    </main>
  );
}

export default function ClerkEntry() {
  const [status, setStatus] = useState<AuthReadiness | 'checking' | 'unavailable'>('checking');

  useEffect(() => {
    let active = true;
    if (typeof fetch !== 'function') {
      setStatus('unavailable');
      return () => { active = false; };
    }
    void fetchAuthReadiness(basePath)
      .then((next) => { if (active) setStatus(next); })
      .catch(() => { if (active) setStatus('unavailable'); });
    return () => { active = false; };
  }, []);

  if (status === 'checking') {
    return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(222_24%_96%)] text-sm text-muted-foreground">Checking authentication configuration…</div>;
  }
  if (status === 'unavailable') {
    return <ClosedAuthScreen message="Authentication readiness could not be verified. Access remains blocked until the same-origin configuration endpoint is available." />;
  }
  if (status.mode !== 'clerk' || !status.ready) {
    return <ClosedAuthScreen message={`The browser build expects Clerk, but the API reports ${status.mode}${status.reason ? ` (${status.reason})` : ''}. Access remains blocked; Clerk was not loaded.`} />;
  }
  return (
    <Suspense fallback={<div className="grid min-h-[100dvh] place-items-center bg-[hsl(222_24%_96%)] text-sm text-muted-foreground">Loading Analyst Workbench…</div>}>
      <ClerkApp />
    </Suspense>
  );
}
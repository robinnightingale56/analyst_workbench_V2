import { useEffect, useState } from 'react';
import { fetchAuthReadiness, type AuthReadiness } from './auth-readiness';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
// This entry is only selected for a PKI build; the fallback keeps direct,
// provider-free component tests aligned with that production invariant.
const buildAuthMode = import.meta.env.VITE_AUTH_MODE ?? 'pki';

type PkiAuthStatus = AuthReadiness | {
  mode: 'unavailable';
  ready: false;
  reason: 'AUTH_MODE_UNAVAILABLE';
};

function PkiLanding() {
  const [status, setStatus] = useState<PkiAuthStatus | null>(null);

  useEffect(() => {
    // This is an informational same-origin readiness check, not an
    // authentication attempt. It makes a web/API AUTH_MODE mismatch visible
    // without accepting any browser-provided identity.
    if (typeof fetch !== 'function') {
      setStatus({ mode: 'unavailable', ready: false, reason: 'AUTH_MODE_UNAVAILABLE' });
      return;
    }
    void fetchAuthReadiness(basePath)
      .then(setStatus)
      .catch(() => setStatus({ mode: 'unavailable', ready: false, reason: 'AUTH_MODE_UNAVAILABLE' }));
  }, []);

  const mismatch = status && status.mode !== buildAuthMode;
  return (
    <main className="min-h-[100dvh] bg-[hsl(222_38%_15%)] px-6 py-6 text-white">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-4xl flex-col">
        <header className="flex items-center gap-3 border-b border-white/10 pb-5">
          <img src={`${basePath}/logo.svg`} className="h-9 w-9" alt="" />
          <div>
            <div className="display text-lg font-bold">Analyst Workbench</div>
            <div className="mono text-[9px] uppercase tracking-[0.16em] text-white/50">PKI integration readiness</div>
          </div>
        </header>
        <section className="my-auto max-w-2xl py-16">
          <div className="mono inline-flex border border-[hsl(39_92%_65%_/_0.45)] bg-[hsl(39_92%_65%_/_0.12)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(39_92%_72%)]">
            Certificate sign-in not configured
          </div>
          <h1 className="display mt-6 text-4xl font-bold tracking-tight md:text-5xl">Restricted portal setup is required.</h1>
          <p className="mt-5 text-lg leading-8 text-white/70">
            This deployment is prepared for an approved PKI identity integration, but it does not authenticate certificates yet. No password, social sign-in, account registration, or certificate upload is available here.
          </p>
          <div className="mt-8 border border-white/15 bg-white/5 p-5 text-sm leading-6 text-white/70">
            <div className="font-semibold text-white">Administrator guidance</div>
            <p className="mt-2">Provide the approved identity protocol or mTLS gateway, trust and revocation policy, claims-to-role mapping, lifecycle controls, and reviewed identifier migration before enabling access.</p>
          </div>
          <p className="mt-6 text-sm font-semibold text-[hsl(174_55%_68%)]">
            Follow the PKI deployment requirements before enabling access.
          </p>
          <p className="mono mt-8 text-[10px] uppercase tracking-[0.12em] text-white/45" data-testid="pki-auth-status">
            Build mode: {buildAuthMode} · API: {status ? `${status.mode}${status.reason ? ` / ${status.reason}` : ''}` : 'checking'}
            {mismatch ? ' · configuration mismatch — access remains blocked' : ''}
          </p>
        </section>
        <footer className="border-t border-white/10 pt-5 text-xs text-white/45">
          This public-network prototype is not an accredited classified deployment.
        </footer>
      </div>
    </main>
  );
}

export default function PkiApp() {
  // Every route intentionally renders setup guidance. In particular, direct
  // navigation to /user-portal cannot become a fake authenticated portal.
  return <PkiLanding />;
}
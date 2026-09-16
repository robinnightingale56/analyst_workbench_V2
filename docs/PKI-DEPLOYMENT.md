# PKI integration deployment requirements

`AUTH_MODE=pki` is a deliberately **unready** mode. It exposes a static setup
page, disables the Clerk browser proxy, and returns `503 PKI_NOT_CONFIGURED`
from every protected API route. It does not perform certificate authentication,
parse client certificates, accept certificate uploads, trust identity headers,
or fall back to Clerk cookies. Do not deploy it as an access-enabled system.

## Required decisions and inputs

The target security, identity, and platform teams must provide approved,
non-secret design inputs before an adapter is implemented:

1. The target identity pattern: OIDC, SAML, or an mTLS-terminating gateway
   with an authenticated assertion contract. Identify the authoritative issuer
   or gateway and its protocol metadata.
2. Trust-anchor ownership, certificate path-validation policy, allowed
   algorithms, revocation checking (OCSP/CRL), freshness/failure behavior, and
   certificate renewal/revocation operations. Trust material and private keys
   must be delivered through approved deployment controls, never source code
   or browser uploads.
3. Required verified claims, approved roles and authorization mapping,
   provisioning/deprovisioning, account recovery, session lifetime, and
   logout behavior. Open self-service signup is not permitted.
4. A reviewed migration that maps the future provider's immutable
   `issuer + subject` to existing `analysis_sessions.owner_id` values. Preserve
   owner predicates and historic records. Do **not** auto-link by email,
   display name, or a browser-supplied identifier.
5. Audit, incident response, key rollover, testing, authorization review, and
   deployment accreditation requirements for the target environment.

The future adapter should produce only the server-side `TrustedPrincipal`
boundary in `api_server.auth` after cryptographic verification and reviewed
mapping. Application routes can continue using its stable `subject` as their
existing owner ID.

## Mode coordination

The API reads `AUTH_MODE`, which is `clerk` by default to preserve current
development login. Supported values are exactly `clerk` and `pki`; an invalid
API value fails protected routes closed with `503 AUTH_MODE_INVALID`.

The Vite build also reads `AUTH_MODE` and derives `VITE_AUTH_MODE` from it.
If an operator supplies `VITE_AUTH_MODE`, it must match or the build fails.
The public `/api/auth-mode` endpoint reports the non-secret server mode and
readiness. Before the lazy Clerk application module can load, a Clerk build
also checks that same-origin endpoint and remains on a closed screen unless it
reports `mode=clerk` and `ready=true`; this prevents a stale Clerk build from
egressing to Clerk against a PKI backend. The PKI page likewise surfaces a
mismatch rather than silently presenting an access path. Build a PKI artifact
with:

```sh
pnpm --filter @workspace/analyst-workbench run build:pki
```

No Clerk publishable key is required for that build. The PKI entry is selected
before the Clerk application module is imported, and the PKI page has no
Clerk, Google-font, password, social, signup, or simulated sign-in flow.
`pnpm --filter @workspace/analyst-workbench run test:pki-build` performs an
isolated temporary-output production build, verifies its Rollup manifest and
assets contain no Clerk entry/module or external identity/font URL, and checks
that invalid or conflicting build modes fail.

## Environment boundary

This repository is a public-network prototype. Its source connectors may
egress to public providers, and the legacy Clerk build uses a third-party
identity service; removing external font requests in the PKI build does not
approve any remaining egress. Nothing in this preparation grants authority to
process classified information, connect to an accredited classified network,
or use a target PKI. A separate approved architecture, network/egress review,
identity integration, operational authorization, and accreditation are
required for such a deployment.
---
name: Managed Clerk proxy review
description: Avoid a false-positive production wiring fix when reviewing managed Clerk.
---

Keep the canonical unconditional Clerk proxy URL wiring even when the development environment has no proxy URL.

**Why:** Security review mistook the absent development setting for a production defect. Replit supplies the managed production proxy setting separately; hardcoding it or gating it by build mode would conflict with the supported setup.

**How to apply:** Consult the current Clerk setup skill and verify build propagation before changing proxy wiring. Review backend origin trust separately; the platform-managed setting does not justify trusting arbitrary forwarded hosts.
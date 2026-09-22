---
name: Public feed coordination boundaries
description: Why shared discovery uses the existing SQL store and fails closed.
---

Keep public discovery coordination on the existing shared database rather than introducing a second cache service. If coordination is unavailable, do not silently fall back to independent provider calls.

**Why:** Cross-instance protection must hold during degraded operation too; a local fallback would let every replica retry the upstream provider simultaneously. Reusing SQL avoids a separate service dependency solely for two fixed public feeds.

**How to apply:** Preserve this fail-closed boundary when changing retry behavior or adding availability handling. Any new shared feed key requires an explicit public-data review; private research and report hydration are outside this cache's scope.
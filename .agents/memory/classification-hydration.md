---
name: Classification hydration
description: Preventing public collection during saved-session loading.
---
Gate public collection and cached public results until the requested owned session and its classification are fully restored.

**Why:** A new-question default of UNCLASSIFIED can briefly enable external requests while a saved restricted session is still loading. Hiding results after the classification effect runs does not prevent that request.

**How to apply:** For session-route changes, treat unresolved classification as blocked for collection. Regression tests must inspect initial hook calls and cached-result visibility, not only the final rendered state after effects.
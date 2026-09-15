---
name: Generated declaration freshness
description: Why composite library type checks must not trust cached build metadata for ignored declaration output.
---

Composite library checks must force declaration regeneration when leaf applications consume generated client contracts.

**Why:** Replit workspace state can retain ignored incremental metadata and ignored declaration output with different ages. A normal incremental build may report the library as current while leaf checks resolve stale declarations that omit newer generated API members.

**How to apply:** Keep the canonical library type-check command deterministic for declaration output. If a leaf reports missing generated exports that exist in source, compare declaration output before changing the contract or adding local types.
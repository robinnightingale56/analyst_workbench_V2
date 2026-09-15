---
name: PostgreSQL contract isolation
description: Why persistence compatibility tests use a cloned temporary schema.
---

Run cross-runtime PostgreSQL compatibility tests in a run-specific schema cloned from the live Drizzle table, and point every participating runtime at that schema through `search_path`.

**Why:** Cleanup behavior uses synthetic timestamps and broad production predicates. Running it against the shared development table can delete unrelated archived user records, which defeats the data-preservation goal.

**How to apply:** Any integration test that exercises broad update, cleanup, migration, or deletion behavior must create an isolated schema before importing database modules, use it for all runtimes, and drop it in teardown even after failures.
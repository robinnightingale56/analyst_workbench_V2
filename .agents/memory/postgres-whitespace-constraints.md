---
name: PostgreSQL whitespace constraints
description: How to enforce whitespace-only rejection and ensure Drizzle applies changed check expressions.
---

Use a POSIX whitespace expression such as `!~ '^[[:space:]]*$'` when a PostgreSQL constraint must reject every whitespace-only string; `BTRIM` without an explicit character set removes spaces but not tabs or newlines.

**Why:** A run identifier containing only tabs/newlines passed a `BTRIM(value) <> ''` check. Drizzle also did not detect an expression-only change while the check constraint retained the same name.

**How to apply:** For non-blank text ownership fields, require both `IS NOT NULL` and a POSIX non-whitespace match. Rename an existing check constraint when changing its expression so schema push replaces it reliably.
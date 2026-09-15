---
name: Canvas Vitest isolation
description: Why Canvas configuration tests use a separate Vitest config.
---

Canvas configuration tests must run through a dedicated Vitest config rather than letting Vitest auto-load the artifact's Vite config.

**Why:** The Canvas Vite config intentionally requires `PORT` and `BASE_PATH` while serving. Vitest auto-loading that file bootstraps in serve mode before tests run, so missing workflow-only environment values abort the test runner.

**How to apply:** Point Canvas test scripts at `vitest.config.ts`, then import `createViteConfig` inside tests with explicit build or serve inputs.
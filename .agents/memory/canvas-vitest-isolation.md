---
name: Canvas Vitest isolation
description: Why Canvas configuration tests use a separate Vitest config.
---

Canvas configuration tests must run through a dedicated Vitest config rather than letting Vitest auto-load the artifact's Vite config.

**Why:** The Canvas Vite config intentionally requires `PORT` and `BASE_PATH` while serving. Vitest auto-loading that file bootstraps in serve mode before tests run, so missing workflow-only environment values abort the test runner.

**How to apply:** Point Canvas test scripts at `vitest.config.ts`, then import `createViteConfig` inside tests with explicit build or serve inputs.

Build-backed tests need a longer timeout than Vitest's five-second unit-test default.

**Why:** Parallel validation builds contend for CPU; a unit-test timeout can report resource contention as an asset-path failure.

**How to apply:** Preserve assertions and use an explicit bounded integration-test timeout for tests that invoke a full Vite build.
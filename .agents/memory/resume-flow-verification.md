---
name: Resume-flow verification
description: Why evidence restoration needs route-level regression coverage.
---

Verify session restoration through every real navigation entry point, particularly Sessions → Open.

**Why:** Helper tests and a direct workbench render passed while actual Sessions navigation restored the assessment but lost its selected evidence. A callback-specific initialization path did not run for ordinary route navigation.

**How to apply:** Use a route-level component test with saved evidence different from default selections. Check that saved selection, including an intentionally empty selection, survives navigation and data loading without automatic defaults replacing it.
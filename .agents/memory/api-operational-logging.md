---
name: API operational logging
description: Application INFO logging under the default Uvicorn service
---

Verify operational INFO events in a standalone process, not only pytest log capture.

**Why:** Uvicorn's default configuration handles its own loggers but does not
provide an application root handler. Setting an application logger to INFO alone
can pass caplog tests while dropping successful outcomes in the running service.

**How to apply:** When adding application telemetry, ensure it has a configured
output sink without enabling verbose third-party or SQL parameter logging.
---
name: Factual count evidence
description: Reliability rules for synthesizing incident counts from retrieved reporting.
---

Only present a numeric incident count when each included event has affirmative, completed-event evidence naming both requested parties, stating an event date, and carrying at least one valid citation. Keep event vocabulary consistent across question intent, party parsing, and source extraction. Deduplicate only on event-specific identity, not generic party or conflict language.

**Why:** Permissive parsing, metadata-only discovery records, negated or speculative mentions, and broad similarity rules can produce false zeros, unsupported inclusions, or merged distinct events while still appearing cited.

**How to apply:** Treat ambiguous questions and metadata-only results as insufficient evidence rather than zero. Require sentence-local support, preserve unique citation IDs, test natural question variants and negative claims, and block finalization of uncited or unsupported counts.
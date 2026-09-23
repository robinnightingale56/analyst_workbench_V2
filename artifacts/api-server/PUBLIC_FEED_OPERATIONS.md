# Shared public feed operations

The `api_server.public_feed` logger emits INFO outcomes and WARNING failures
as `public_feed event=… feed=… count=… [duration_seconds=…]`.
Only the two fixed public feed IDs appear as labels. Never add exception text,
SQL parameters, prompts, session IDs, lease tokens, feed contents, credentials,
or URLs. Do not enable SQL parameter logging to investigate these warnings.

Counters are thread-safe and process-local (`feed_signals.counters()`), reset on
restart, and are not exposed through a public endpoint. For fleet-wide alerts,
count matching log events across replicas in your log monitoring service;
do not sum the cumulative `count` fields. No external alert destination is
configured by this change.

## Operator thresholds

* Any `claim_database_error` / `publish_database_error`: investigate database
  connectivity, pool saturation and schema availability immediately. The request
  fails closed; do not work around it with independent provider calls.
* `lease_expired`: an abandoned lease was reclaimed after a committed transaction.
  Three per feed in five minutes warrants a warning alert. A worker emits
  `lease_expired_repeated` when it observes this threshold locally; aggregate
  `lease_expired` across workers as well. Check worker restarts, stalls and database
  latency. `publish_rejected` means fencing rejected a late or superseded writer,
  not necessarily a new expiration; do not count it twice.
* `refresh_slow`: total shared refresh/read elapsed time >= one lease (normally
  15 seconds). Includes provider work, database work and peer wait, not just sleep.
  Alert on three per feed in five minutes; inspect the same worker/DB signals.
  `refresh_complete`, `refresh_failed`, `refresh_cancelled` and `refresh_timeout`
  each carry the terminal duration, including error paths.
* Any `refresh_timeout`: investigate immediately. The existing wait budget is
  two leases + two seconds (normally 32 seconds); it is not a hard deadline on
  an individual blocked database call. No provider fallback is introduced.
* `publish_success` / `publish_error` describe committed refresh results;
  `cache_success` / `cache_error` describe authoritative cached outcomes read,
  including the refreshing worker's read-back. Successful empty feeds count as
  success. `stale_fallback` means a recent last-good snapshot was restored after
  a cached error. Alert on three `publish_error` events for a feed in ten minutes,
  or error reads without any `publish_success` for ten minutes during traffic.
  Inspect provider availability without recording provider response content.

These are traffic-driven signals, not a background heartbeat. Silence without
requests does not prove a stalled feed. Archive readiness and provider retry
policies are unchanged.
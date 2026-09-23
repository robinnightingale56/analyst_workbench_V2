"""Bounded, process-local counters and privacy-safe operational log events."""
import logging
from collections import Counter, deque
from threading import Lock
from time import monotonic

PUBLIC_FEED_KEYS = ("google-world-v1", "bbc-world-v1")
logger = logging.getLogger("api_server.public_feed")
logger.setLevel(logging.INFO)
# Uvicorn configures its own loggers, not the application's root logger.
# Supply a sink so INFO cache outcomes are visible in the default service.
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())
_lock = Lock()
_counts = Counter()
_expirations = {key: deque(maxlen=3) for key in PUBLIC_FEED_KEYS}
EVENTS = frozenset({
    "claim_database_error", "publish_database_error", "lease_expired",
    "lease_expired_repeated", "publish_rejected", "publish_success",
    "publish_error", "cache_success", "cache_error", "stale_fallback",
    "refresh_complete", "refresh_failed", "refresh_cancelled", "refresh_timeout",
    "refresh_slow",
})
WARNINGS = frozenset({
    "claim_database_error", "publish_database_error", "lease_expired",
    "lease_expired_repeated", "publish_rejected", "refresh_failed",
    "refresh_timeout", "refresh_slow",
})


def signal(feed, event, *, duration=None):
    # No arbitrary labels, exception strings, tokens, snapshots or request data.
    if feed not in PUBLIC_FEED_KEYS or event not in EVENTS:
        raise ValueError("Invalid public feed signal")
    repeated = False
    with _lock:
        _counts[(feed, event)] += 1
        count = _counts[(feed, event)]
        if event == "lease_expired":
            history = _expirations[feed]
            now = monotonic()
            history.append(now)
            repeated = len(history) == 3 and now - history[0] <= 300
    fields = f"public_feed event={event} feed={feed} count={count}"
    if duration is not None:
        fields += f" duration_seconds={max(0, duration):.3f}"
    logger.log(logging.WARNING if event in WARNINGS else logging.INFO, fields)
    if repeated:
        signal(feed, "lease_expired_repeated")


def counters():
    """Internal diagnostic snapshot, not an unauthenticated HTTP endpoint."""
    with _lock:
        return dict(_counts)
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_CLEANUP_INTERVAL_MINUTES = 6 * 60;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type ArchivedSessionSettings = {
  retentionDays: number;
  cleanupIntervalMinutes: number;
  cleanupIntervalMs: number;
};

function parsePositiveNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
) {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue === "") return defaultValue;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Invalid ${name} value: "${rawValue}". Expected a positive number.`,
    );
  }
  return value;
}

export function getArchivedSessionSettings(
  env: NodeJS.ProcessEnv = process.env,
): ArchivedSessionSettings {
  const retentionDays = parsePositiveNumber(
    env,
    "ARCHIVED_SESSION_RETENTION_DAYS",
    DEFAULT_RETENTION_DAYS,
  );
  const cleanupIntervalMinutes = parsePositiveNumber(
    env,
    "ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES",
    DEFAULT_CLEANUP_INTERVAL_MINUTES,
  );
  const cleanupIntervalMs = cleanupIntervalMinutes * 60 * 1000;

  if (cleanupIntervalMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `Invalid ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES value: "${env["ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES"]}". Expected at most ${MAX_TIMER_DELAY_MS / 60_000} minutes.`,
    );
  }

  return { retentionDays, cleanupIntervalMinutes, cleanupIntervalMs };
}
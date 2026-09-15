export type VitePortConfig = {
  port?: number;
  strictPort?: boolean;
};

export function createVitePortConfig(
  rawPort: string | undefined,
  options: { strictPortWhenUnset?: boolean } = {},
): VitePortConfig {
  if (rawPort === undefined) {
    return options.strictPortWhenUnset ? { strictPort: true } : {};
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return { port, strictPort: true };
}

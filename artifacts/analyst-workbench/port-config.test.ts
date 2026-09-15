// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createViteConfig } from './vite.config';

const productionEnv = { NODE_ENV: 'production' };

describe('Vite port configuration', () => {
  it('leaves development and preview ports unset when PORT is omitted', async () => {
    const config = await createViteConfig(productionEnv);

    expect(config.server).not.toHaveProperty('port');
    expect(config.preview).not.toHaveProperty('port');
  });

  it('uses a valid PORT for development and preview', async () => {
    const config = await createViteConfig({
      ...productionEnv,
      PORT: '4173',
    });

    expect(config.server.port).toBe(4173);
    expect(config.preview.port).toBe(4173);
  });

  it.each(['', 'abc', '12.5', '0', '-1', '65536'])(
    'rejects invalid PORT value %j',
    async (port) => {
      await expect(
        createViteConfig({ ...productionEnv, PORT: port }),
      ).rejects.toThrow(`Invalid PORT value: "${port}"`);
    },
  );
});
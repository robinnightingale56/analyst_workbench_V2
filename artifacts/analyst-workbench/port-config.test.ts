// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createServer, preview } from 'vite';

import { withOccupiedPort } from '../test-utils/occupied-port';
import { createViteConfig } from './vite.config';

const productionEnv = { NODE_ENV: 'production' };

describe('Vite port configuration', () => {
  it('leaves development and preview ports unset when PORT is omitted', async () => {
    const config = await createViteConfig(productionEnv);

    expect(config.base).toBe('/');
    expect(config.server).not.toHaveProperty('port');
    expect(config.preview).not.toHaveProperty('port');
    expect(config.server.strictPort).toBe(true);
    expect(config.preview.strictPort).toBe(true);
  });

  it('honors an explicit BASE_PATH without changing missing-PORT behavior', async () => {
    const config = await createViteConfig({
      ...productionEnv,
      BASE_PATH: '/analyst/',
    });

    expect(config.base).toBe('/analyst/');
    expect(config.server).not.toHaveProperty('port');
    expect(config.preview).not.toHaveProperty('port');
    expect(config.server.strictPort).toBe(true);
    expect(config.preview.strictPort).toBe(true);
  });

  it('uses a valid PORT for development and preview', async () => {
    const config = await createViteConfig({
      ...productionEnv,
      PORT: '4173',
    });

    expect(config.server.port).toBe(4173);
    expect(config.preview.port).toBe(4173);
    expect(config.server.strictPort).toBe(true);
    expect(config.preview.strictPort).toBe(true);
  });

  it('fails development and preview consistently when PORT is occupied', async () => {
    await withOccupiedPort(async (port) => {
      const config = await createViteConfig({
        ...productionEnv,
        PORT: String(port),
      });
      const developmentServer = await createServer({
        configFile: false,
        root: import.meta.dirname,
        server: config.server,
      });

      await expect(developmentServer.listen()).rejects.toThrow(
        `Port ${port} is already in use`,
      );
      await developmentServer.close();

      await expect(
        preview({
          configFile: false,
          root: import.meta.dirname,
          preview: config.preview,
        }),
      ).rejects.toThrow(`Port ${port} is already in use`);
    });
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
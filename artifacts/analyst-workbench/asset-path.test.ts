// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { build } from 'vite';
import { describe, expect, it } from 'vitest';

import { createViteConfig } from './vite.config';

const basePath = '/custom-analyst/';

describe('production asset paths', () => {
  it('emits local asset references under the configured BASE_PATH', async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), 'analyst-workbench-build-'),
    );

    try {
      const config = await createViteConfig({
        BASE_PATH: basePath,
        NODE_ENV: 'production',
      });

      await build({
        ...config,
        configFile: false,
        build: {
          ...config.build,
          outDir: outputDirectory,
        },
      });

      const html = await readFile(
        path.join(outputDirectory, 'index.html'),
        'utf8',
      );
      const localReferences = [
        ...html.matchAll(/(?:src|href)="(\/[^"]+)"/g),
      ]
        .map((match) => match[1])
        .filter((reference) => reference.startsWith('/'));

      expect(localReferences).not.toHaveLength(0);
      expect(localReferences).toEqual(
        expect.arrayContaining([
          expect.stringMatching(`${basePath}assets/.*\\.js$`),
          expect.stringMatching(`${basePath}assets/.*\\.css$`),
        ]),
      );
      expect(
        localReferences.every((reference) => reference.startsWith(basePath)),
      ).toBe(true);

      for (const reference of localReferences) {
        const relativePath = reference.slice(basePath.length);
        await expect(
          readFile(path.join(outputDirectory, relativePath)),
        ).resolves.toBeDefined();
      }
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
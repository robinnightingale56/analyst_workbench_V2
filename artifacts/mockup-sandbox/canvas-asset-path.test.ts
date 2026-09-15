// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { build, preview } from "vite";
import { describe, expect, it } from "vitest";

import { createViteConfig } from "./vite.config";

const basePath = "/__mockup/";

describe("Canvas production asset paths", () => {
  it("emits local assets under the configured preview path", async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), "canvas-preview-build-"),
    );

    try {
      const config = await createViteConfig(
        { BASE_PATH: basePath, NODE_ENV: "production" },
        "build",
      );

      await build({
        ...config,
        configFile: false,
        build: {
          ...config.build,
          outDir: outputDirectory,
        },
      });

      const html = await readFile(
        path.join(outputDirectory, "index.html"),
        "utf8",
      );
      const localReferences = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
        .map((match) => match[1])
        .filter((reference) => reference.startsWith("/"));

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

      const previewServer = await preview({
        ...config,
        configFile: false,
        build: {
          ...config.build,
          outDir: outputDirectory,
        },
        preview: {
          ...config.preview,
          host: "127.0.0.1",
          port: 0,
          strictPort: true,
        },
      });

      try {
        const address = previewServer.httpServer.address();
        if (address === null || typeof address === "string") {
          throw new Error("Could not determine the Canvas preview server port");
        }

        const entryUrl = `http://127.0.0.1:${address.port}${basePath}`;
        const entryResponse = await fetch(entryUrl);
        expect(entryResponse.status).toBe(200);

        const servedHtml = await entryResponse.text();
        const scriptReference = [
          ...servedHtml.matchAll(/<script[^>]+src="([^"]+)"/g),
        ]
          .map((match) => match[1])
          .find(
            (reference) =>
              reference.startsWith(`${basePath}assets/`) &&
              reference.endsWith(".js"),
          );

        expect(scriptReference).toBeDefined();

        const assetResponse = await fetch(
          `http://127.0.0.1:${address.port}${scriptReference}`,
        );
        expect(assetResponse.status).toBe(200);
      } finally {
        await previewServer.httpServer.close();
      }
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});

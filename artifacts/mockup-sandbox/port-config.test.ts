// @vitest-environment node

import { once } from "node:events";
import { createServer as createNetServer } from "node:net";

import { describe, expect, it } from "vitest";
import { createServer, preview } from "vite";

import { createViteConfig } from "./vite.config";

const productionEnv = { NODE_ENV: "production" };

async function withOccupiedPort(
  verify: (port: number) => Promise<void>,
): Promise<void> {
  const occupied = createNetServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const address = occupied.address();
  if (address === null || typeof address === "string") {
    occupied.close();
    throw new Error("Could not reserve a test port");
  }

  try {
    await verify(address.port);
  } finally {
    occupied.close();
    await once(occupied, "close");
  }
}

describe("Canvas Vite port configuration", () => {
  it("leaves development and preview ports unset for a build without PORT", async () => {
    const config = await createViteConfig(productionEnv, "build");

    expect(config.base).toBe("/__mockup/");
    expect(config.server).not.toHaveProperty("port");
    expect(config.server).not.toHaveProperty("strictPort");
    expect(config.preview).not.toHaveProperty("port");
    expect(config.preview).not.toHaveProperty("strictPort");
  });

  it("rejects a serve without PORT", async () => {
    await expect(createViteConfig(productionEnv, "serve")).rejects.toThrow(
      "PORT environment variable is required but was not provided.",
    );
  });

  it("honors an explicit BASE_PATH for a build without PORT", async () => {
    const config = await createViteConfig(
      { ...productionEnv, BASE_PATH: "/custom-canvas/" },
      "build",
    );

    expect(config.base).toBe("/custom-canvas/");
  });

  it("uses strict binding for development and preview when PORT is configured", async () => {
    const config = await createViteConfig(
      { ...productionEnv, PORT: "4173", BASE_PATH: "/__mockup/" },
      "serve",
    );

    expect(config.server).toMatchObject({ port: 4173, strictPort: true });
    expect(config.preview).toMatchObject({ port: 4173, strictPort: true });
  });

  it("fails development and preview when the configured PORT is occupied", async () => {
    await withOccupiedPort(async (port) => {
      const config = await createViteConfig(
        {
          ...productionEnv,
          PORT: String(port),
          BASE_PATH: "/__mockup/",
        },
        "serve",
      );
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
});
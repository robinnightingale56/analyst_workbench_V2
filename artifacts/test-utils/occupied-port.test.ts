// @vitest-environment node

import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { describe, expect, it } from "vitest";

import { withOccupiedPort } from "./occupied-port";

describe("withOccupiedPort", () => {
  it("releases the reserved port when the verification callback rejects", async () => {
    let reservedPort: number | undefined;
    const verificationError = new Error("verification failed");

    await expect(
      withOccupiedPort(async (port) => {
        reservedPort = port;
        throw verificationError;
      }),
    ).rejects.toBe(verificationError);

    expect(reservedPort).toBeDefined();
    if (reservedPort === undefined) {
      throw new Error("The helper did not provide a reserved port");
    }

    const rebound = createNetServer();
    try {
      rebound.listen(reservedPort, "127.0.0.1");
      await once(rebound, "listening");
    } finally {
      if (rebound.listening) {
        await new Promise<void>((resolve, reject) => {
          rebound.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    }
  });
});

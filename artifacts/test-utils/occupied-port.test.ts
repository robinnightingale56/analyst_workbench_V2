// @vitest-environment node

import { EventEmitter, once } from "node:events";
import { createServer as createNetServer, type Server } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { withOccupiedPort } from "./occupied-port";

describe("withOccupiedPort", () => {
  it("closes the server and preserves the reservation error", async () => {
    const reservationError = new Error("reservation failed");
    const occupied = new EventEmitter() as EventEmitter & {
      listen: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    occupied.listen = vi.fn(() => {
      queueMicrotask(() => occupied.emit("error", reservationError));
      return occupied;
    });
    occupied.close = vi.fn(() => occupied);

    await expect(
      withOccupiedPort(
        async () => {
          throw new Error("verification should not run");
        },
        () => occupied as unknown as Server,
      ),
    ).rejects.toBe(reservationError);

    expect(occupied.close).toHaveBeenCalledOnce();
  });

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

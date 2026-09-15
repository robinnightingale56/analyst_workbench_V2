import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import type { Server } from "node:net";

type CreateNetServer = () => Server;

export async function withOccupiedPort(
  verify: (port: number) => Promise<void>,
  createServer: CreateNetServer = createNetServer,
): Promise<void> {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    const handleListening = () => {
      occupied.off("error", handleError);
      resolve();
    };
    const handleError = (error: Error) => {
      occupied.off("listening", handleListening);
      try {
        occupied.close();
      } catch {
        // A failed listen can leave the server already closed.
      }
      reject(error);
    };

    occupied.once("listening", handleListening);
    occupied.once("error", handleError);
    try {
      occupied.listen(0, "127.0.0.1");
    } catch (error) {
      handleError(error as Error);
    }
  });
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

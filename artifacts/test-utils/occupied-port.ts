import { once } from "node:events";
import { createServer as createNetServer } from "node:net";

export async function withOccupiedPort(
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

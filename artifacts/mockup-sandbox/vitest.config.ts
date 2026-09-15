import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["port-config.test.ts", "canvas-asset-path.test.ts"],
  },
});
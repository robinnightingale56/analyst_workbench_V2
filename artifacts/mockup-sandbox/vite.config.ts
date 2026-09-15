import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

export async function createViteConfig(
  env: NodeJS.ProcessEnv,
  command: "build" | "serve",
): Promise<UserConfig> {
  const rawPort = env.PORT;

  if (command === "serve" && !rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = rawPort === undefined ? undefined : Number(rawPort);

  if (
    port !== undefined &&
    (!Number.isInteger(port) || port <= 0 || port > 65_535)
  ) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath =
    env.BASE_PATH ?? (command === "build" ? "/__mockup/" : undefined);

  if (!basePath) {
    throw new Error(
      "BASE_PATH environment variable is required but was not provided.",
    );
  }

  return {
    base: basePath,
    plugins: [
      mockupPreviewPlugin(),
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(env.NODE_ENV !== "production" &&
      env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
    },
    server: {
      ...(port === undefined ? {} : { port }),
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      ...(port === undefined ? {} : { port }),
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
}

export default defineConfig(({ command }) =>
  createViteConfig(process.env, command),
);

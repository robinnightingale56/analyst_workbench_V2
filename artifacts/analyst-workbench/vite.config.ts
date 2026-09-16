import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

import { createVitePortConfig } from '../../vite-port-config';
import { resolveAuthMode } from './src/auth-mode';

export { type AuthMode, resolveAuthMode } from './src/auth-mode';

export async function createViteConfig(env: NodeJS.ProcessEnv) {
  const basePath = env.BASE_PATH ?? '/';
  const authMode = resolveAuthMode(env);
  const portConfig = createVitePortConfig(env.PORT, {
    strictPortWhenUnset: true,
  });

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss({ optimize: false }),
      runtimeErrorOverlay(),
      ...(env.NODE_ENV !== 'production' && env.REPL_ID !== undefined
        ? [
            await import('@replit/vite-plugin-cartographer').then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, '..'),
              }),
            ),
            await import('@replit/vite-plugin-dev-banner').then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        // Select an entry before the browser can import or initialize Clerk.
        // PKI builds therefore have no Clerk provider dependency at runtime.
        '@auth-entry': path.resolve(
          import.meta.dirname,
          'src',
          authMode === 'clerk' ? 'ClerkEntry.tsx' : 'PkiApp.tsx',
        ),
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    define: {
      // The public value is derived from the server-side mode that invoked the
      // build. An explicitly conflicting VITE_AUTH_MODE fails above.
      'import.meta.env.VITE_AUTH_MODE': JSON.stringify(authMode),
    },
    server: {
      ...portConfig,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      ...portConfig,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
}

export default defineConfig(() => createViteConfig(process.env));

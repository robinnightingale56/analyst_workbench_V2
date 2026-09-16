import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workbenchDir = process.cwd();
const viteArgs = ['exec', 'vite', 'build', '--config', 'vite.config.ts', '--manifest'];

function runBuild(name, env) {
  const outputDir = mkdtempSync(join(tmpdir(), `analyst-workbench-${name}-`));
  const result = spawnSync('pnpm', [...viteArgs, '--outDir', outputDir], {
    cwd: workbenchDir,
    env: { ...process.env, NODE_ENV: 'production', ...env },
    encoding: 'utf8',
  });
  return { outputDir, result };
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function assertFailClosedBuild(name, env) {
  const { outputDir, result } = runBuild(name, env);
  try {
    if (result.status === 0) {
      throw new Error(`${name} build unexpectedly succeeded`);
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

const { outputDir, result } = runBuild('pki-contract', {
  AUTH_MODE: 'pki',
  VITE_AUTH_MODE: 'pki',
});

try {
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error('PKI production build failed');
  }
  const output = filesUnder(outputDir)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const manifest = readFileSync(join(outputDir, '.vite', 'manifest.json'), 'utf8');
  const forbiddenOutput = [
    /@clerk/i,
    /clerk\.dev/i,
    /fonts\.googleapis\.com/i,
    /fonts\.gstatic\.com/i,
    /ClerkEntry/,
    /src\/App\.tsx/,
  ];
  for (const pattern of forbiddenOutput) {
    if (pattern.test(output) || pattern.test(manifest)) {
      throw new Error(`PKI build output contains forbidden Clerk/font reference: ${pattern}`);
    }
  }
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}

assertFailClosedBuild('invalid-mode', { AUTH_MODE: 'invalid', VITE_AUTH_MODE: 'invalid' });
assertFailClosedBuild('conflicting-mode', { AUTH_MODE: 'pki', VITE_AUTH_MODE: 'clerk' });

console.log('PKI production Rollup graph and auth-mode contract verified.');
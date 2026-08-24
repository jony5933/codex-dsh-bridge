import assert from 'node:assert/strict';
import {
  copyFile,
  lstat,
  realpath,
  rm,
  unlink,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const worktree = process.argv[2];
const dependencyDirectory = process.argv[3];
assert.ok(worktree, 'Runner must pass the execution worktree as argv[2]');
assert.ok(dependencyDirectory, 'Contract must pass the trusted dependency directory as argv[3]');

const nodeModules = join(worktree, 'node_modules');
const acceptanceTest = join(
  worktree,
  'src/pages/table-list/runner.acceptance.test.tsx',
);
const umiDevelopment = join(worktree, 'src/.umi');
const umiProduction = join(worktree, 'src/.umi-production');
const buildOutput = join(worktree, 'dist');
const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/ant-design-table-states.acceptance.test.tsx',
);

async function assertMissing(path, label) {
  try {
    await lstat(path);
    assert.fail(`${label} must not exist before independent acceptance: ${path}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function run(label, args, timeout, extraEnvironment = {}) {
  const result = spawnSync('npm', args, {
    cwd: worktree,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnvironment },
    maxBuffer: 16 * 1024 * 1024,
    timeout,
  });
  process.stdout.write(`\n[${label}]\n${result.stdout ?? ''}`);
  process.stderr.write(result.stderr ?? '');
  assert.equal(result.error, undefined, `${label} failed to start`);
  assert.equal(result.signal, null, `${label} terminated by ${result.signal}`);
  assert.equal(result.status, 0, `${label} exited with ${result.status}`);
}

function cloneDependencies(source, destination) {
  const result = spawnSync('/bin/cp', ['-cR', source, destination], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(`\n[isolated dependency clone]\n${result.stdout ?? ''}`);
  process.stderr.write(result.stderr ?? '');
  assert.equal(result.error, undefined, 'dependency clone failed to start');
  assert.equal(result.signal, null, `dependency clone terminated by ${result.signal}`);
  assert.equal(result.status, 0, `dependency clone exited with ${result.status}`);
}

await assertMissing(nodeModules, 'worktree node_modules');
await assertMissing(acceptanceTest, 'hidden acceptance test');
await assertMissing(umiDevelopment, 'worktree generated .umi types');
await assertMissing(umiProduction, 'worktree generated .umi-production files');
await assertMissing(buildOutput, 'worktree build output');
const canonicalDependencies = await realpath(dependencyDirectory);
assert.equal(
  canonicalDependencies,
  dependencyDirectory,
  'dependency directory must be a canonical path',
);
const preserveSymlinkEnvironment = {
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--preserve-symlinks']
    .filter(Boolean)
    .join(' '),
};

try {
  // Utoopack rejects package symlinks that resolve outside the worktree. APFS
  // clone-on-write keeps validation isolated without downloading dependencies.
  cloneDependencies(canonicalDependencies, nodeModules);
  await rm(join(nodeModules, '.cache'), { recursive: true, force: true });
  await copyFile(fixture, acceptanceTest);
  run(
    'target and hidden TableList tests',
    ['test', '--', 'src/pages/table-list/index.test.tsx', 'src/pages/table-list/runner.acceptance.test.tsx'],
    180_000,
  );
  await unlink(acceptanceTest);
  run(
    'Umi generated types',
    ['exec', '--', 'max', 'setup'],
    180_000,
    preserveSymlinkEnvironment,
  );
  run('TypeScript', ['run', 'tsc', '--', '--preserveSymlinks'], 180_000);
  run(
    'production build',
    ['run', 'build'],
    300_000,
    preserveSymlinkEnvironment,
  );
} finally {
  await unlink(acceptanceTest).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  await rm(nodeModules, { recursive: true, force: true });
  await rm(umiDevelopment, { recursive: true, force: true });
  await rm(umiProduction, { recursive: true, force: true });
  await rm(buildOutput, { recursive: true, force: true });
}

process.stdout.write('\nAnt Design Pro TableList independent acceptance passed\n');

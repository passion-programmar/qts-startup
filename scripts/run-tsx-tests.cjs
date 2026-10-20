const path = require('node:path');
const { spawnSync } = require('node:child_process');

const shimPath = path.resolve(__dirname, 'node-user-shim.cjs');
const nodeOptions = [
  process.env.NODE_OPTIONS,
  `--require=${shimPath}`,
].filter(Boolean).join(' ');

const result = spawnSync(
  process.execPath,
  [
    './node_modules/tsx/dist/cli.mjs',
    '--test',
    'src/server/**/*.test.ts',
  ],
  {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);

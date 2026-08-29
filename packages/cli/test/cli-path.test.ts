import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acceptInstalledCliJs,
  getCliLaunch,
  isInstalledPackageCliJs,
  pathBinFile,
  resolveInstalledCliJs,
  writePathBin,
} from '../src/cli-path.js';

function fakeInstalledCli(root: string): string {
  const cli = path.join(root, 'node_modules', 'aluvia-cli', 'dist', 'esm', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, '#!/usr/bin/env node\n');
  return cli;
}

describe('PATH bin', () => {
  let home: string;
  const prevHome = process.env.HOME;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-bin-'));
    process.env.HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('writePathBin writes mode 0755 targeting installed dist/esm/cli.js', () => {
    const installed = fakeInstalledCli(home);
    const bin = writePathBin({ homedir: home, cliJs: installed });
    assert.strictEqual(bin, pathBinFile(home));
    assert.strictEqual(bin, path.join(home, '.local', 'bin', 'aluvia'));
    const st = fs.statSync(bin!);
    assert.strictEqual(st.mode & 0o777, 0o755);
    const body = fs.readFileSync(bin!, 'utf8');
    assert.match(body, /^#!/);
    assert.match(body, /\bexec\b/);
    assert.ok(body.includes(installed));
    assert.ok(!body.includes(`${path.sep}packages${path.sep}cli${path.sep}`));
    assert.ok(!body.includes('/packages/cli/'));
  });

  test('writePathBin overwrites a mode-644 checkout shim', () => {
    const installed = fakeInstalledCli(home);
    const bin = pathBinFile(home);
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(
      bin,
      '#!/usr/bin/env bash\nexec /usr/bin/env node /repo/packages/cli/dist/esm/cli.js "$@"\n',
      { mode: 0o644 },
    );
    fs.chmodSync(bin, 0o644);
    assert.strictEqual(fs.statSync(bin).mode & 0o777, 0o644);

    const written = writePathBin({ homedir: home, cliJs: installed });
    assert.strictEqual(written, bin);
    assert.strictEqual(fs.statSync(bin).mode & 0o777, 0o755);
    const body = fs.readFileSync(bin, 'utf8');
    assert.ok(body.includes(installed));
    assert.ok(!body.includes('/packages/cli/'));
    assert.ok(!body.includes('packages/cli/dist/esm/cli.js'));
  });

  test('writePathBin refuses a git checkout path', () => {
    const checkout = path.join(home, 'repo', 'packages', 'cli', 'dist', 'esm', 'cli.js');
    fs.mkdirSync(path.dirname(checkout), { recursive: true });
    fs.writeFileSync(checkout, '#!/usr/bin/env node\n');
    assert.strictEqual(isInstalledPackageCliJs(checkout), false);
    assert.strictEqual(acceptInstalledCliJs(checkout), null);
    assert.strictEqual(writePathBin({ homedir: home, cliJs: checkout }), null);
    assert.strictEqual(fs.existsSync(pathBinFile(home)), false);
  });

  test('resolveInstalledCliJs does not return a checkout cli.ts', () => {
    const launch = getCliLaunch();
    assert.ok(launch.script.endsWith(`${path.sep}cli.ts`) || launch.script.endsWith(`${path.sep}cli.js`));
    const resolved = resolveInstalledCliJs();
    if (resolved) {
      assert.strictEqual(isInstalledPackageCliJs(resolved), true);
      assert.ok(!posixIncludesPackagesCli(resolved));
    }
  });
});

function posixIncludesPackagesCli(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  return norm.includes('/packages/cli/') && !norm.includes('/node_modules/');
}

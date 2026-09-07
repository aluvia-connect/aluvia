import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromeDebugPort, readRunningChrome, retainedChromeArgs } from '../src/chrome-process.js';
import { chromeLaunchArgs } from '../src/chrome-launch.js';
import { DEFAULT_SETUP_URL } from '../src/setup-page.js';

test('bare launch opens the HTTPS test page and an explicit URL takes its place', () => {
  const args = chromeLaunchArgs(18787);
  assert.ok(args.includes('--proxy-server=http://127.0.0.1:18787'));
  assert.ok(args.includes('--restore-last-session'));
  assert.equal(args.at(-1), DEFAULT_SETUP_URL);
  const explicit = chromeLaunchArgs(18787, 'https://shop.example/cart');
  assert.equal(explicit.at(-1), 'https://shop.example/cart');
  assert.ok(!explicit.includes(DEFAULT_SETUP_URL));
});

test('restart retains profile and automation settings while replacing proxy and startup settings', () => {
  const existing = [
    '--user-data-dir=/tmp/agent profile',
    '--remote-debugging-port=9222',
    '--remote-debugging-address=127.0.0.1',
    '--profile-directory=Default',
    '--headless=new',
    '--no-sandbox',
    '--proxy-server',
    'http://old:8080',
    '--proxy-pac-url=https://old.example/proxy.pac',
    '--proxy-bypass-list=*',
    '--no-proxy-server',
    '--proxy-auto-detect',
    '--no-startup-window',
    '--restore-last-session',
    'https://old.example/cart',
    'about:blank',
  ];
  assert.deepEqual(retainedChromeArgs(existing), existing.slice(0, 6));
  const launched = chromeLaunchArgs(18787, null, existing);
  assert.equal(launched.filter((arg) => arg.startsWith('--proxy-server')).length, 1);
  assert.equal(launched.at(-1), DEFAULT_SETUP_URL);
  assert.ok(launched.includes('--user-data-dir=/tmp/agent profile'));
  assert.ok(launched.includes('--remote-debugging-port=9222'));
});

test('Linux discovery reads exact main-browser argv and ignores helpers and other programs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-proc-'));
  try {
    function proc(pid: number, binary: string, args: string[]) {
      const entry = path.join(dir, String(pid));
      fs.mkdirSync(entry);
      fs.symlinkSync(binary, path.join(entry, 'exe'));
      fs.writeFileSync(path.join(entry, 'cmdline'), [binary, ...args, ''].join('\0'));
    }
    proc(100, '/usr/bin/node', ['app.js']);
    proc(101, '/opt/google/chrome/chrome', ['--type=renderer']);
    const args = ['--user-data-dir=/tmp/agent profile', '--remote-debugging-port=9222'];
    proc(102, '/opt/google/chrome/chrome', args);
    assert.deepEqual(readRunningChrome(dir), { pid: 102, binary: '/opt/google/chrome/chrome', args });
    assert.equal(readRunningChrome(path.join(dir, 'missing')), null);
    assert.equal(readRunningChrome(dir, '/missing/explicit-browser'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an automatically assigned debugging port is read from the existing profile', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-debug-port-'));
  try {
    const browser = {
      pid: 1,
      binary: 'chrome',
      args: ['--remote-debugging-port=0', '--user-data-dir', profile],
    };
    assert.equal(chromeDebugPort(browser), null);
    fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '9223\n/devtools/browser/test\n');
    assert.equal(chromeDebugPort(browser), 9223);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { buildHelpJson, handleHelp } from '../src/cli.js';
import { captureOutput } from '../src/mcp-helpers.js';

describe('proxy help', () => {
  test('help JSON lists every proxy verb and ALUVIA_HOME', () => {
    const help = buildHelpJson();
    const names = help.commands.map((c) => c.command);
    for (const verb of [
      'setup',
      'start',
      'stop',
      'status',
      'proxy-on',
      'proxy-off',
      'rotate-ip',
      'proxy-provider aluvia',
      'proxy-provider <url>',
      'auth <key>',
      'auth login',
    ]) {
      assert.ok(names.includes(verb), verb);
    }
    assert.ok(!names.includes('set-geo <geo>'));
    assert.ok(!names.includes('attach'));
    assert.ok(!names.includes('upstream <url>'));
    assert.ok(!names.includes('auth --key <key>'));
    assert.ok(!names.includes('auth logout'));
    assert.ok(!names.some((name) => name.startsWith('session')));
    assert.ok(!names.some((name) => name.startsWith('proxy ')));
    const geoFlag = { flag: '--geo <geo>' };
    const proxyOn = help.commands.find((c) => c.command === 'proxy-on');
    const rotate = help.commands.find((c) => c.command === 'rotate-ip');
    assert.ok(proxyOn?.options.some((o) => (o as { flag?: string }).flag === geoFlag.flag));
    assert.ok(rotate?.options.some((o) => (o as { flag?: string }).flag === geoFlag.flag));
    const setup = help.commands.find((c) => c.command === 'setup');
    const start = help.commands.find((c) => c.command === 'start');
    assert.deepStrictEqual(
      setup?.options.map((o) => (o as { flag?: string }).flag),
      ['--url <url>'],
    );
    assert.deepStrictEqual(start?.options, []);
    assert.ok(!help.environment.includes('ALUVIA_PROXY_PORT'));
    assert.ok(help.environment.includes('ALUVIA_HOME'));
    assert.ok(help.environment.includes('ALUVIA_UPSTREAM'));
  });

  test('help is JSON on stdout with next', async () => {
    const result = await captureOutput(() => handleHelp());
    assert.strictEqual(result.isError, false);
    assert.ok(Array.isArray(result.data.commands));
    assert.match(String(result.data.next), /Follow next/);
    const parsed = JSON.parse(JSON.stringify(result.data)) as { next?: string };
    assert.ok(typeof parsed.next === 'string');
  });
});

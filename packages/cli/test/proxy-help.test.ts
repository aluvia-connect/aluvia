import { describe, test } from 'node:test';
import assert from 'node:assert';
import { buildHelpJson } from '../src/cli.js';

describe('proxy help', () => {
  test('help JSON lists every proxy verb and ALUVIA_HOME', () => {
    const help = buildHelpJson();
    const names = help.commands.map((c) => c.command);
    for (const verb of [
      'setup',
      'start',
      'stop',
      'status',
      'route <host>',
      'unroute <host>',
      'attach',
      'rotate-ip',
      'set-geo <geo>',
      'upstream <url>',
    ]) {
      assert.ok(names.includes(verb), verb);
    }
    assert.ok(!names.some((name) => name.startsWith('proxy ')));
    assert.ok(help.environment.includes('ALUVIA_HOME'));
    assert.ok(help.environment.includes('ALUVIA_UPSTREAM'));
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { buildHelpJson } from '../src/cli.js';

describe('proxy help', () => {
  test('help JSON lists every proxy verb and ALUVIA_HOME', () => {
    const help = buildHelpJson();
    const names = help.commands.map((c) => c.command);
    for (const verb of [
      'proxy start',
      'proxy stop',
      'proxy status',
      'proxy route <host>',
      'proxy unroute <host>',
      'proxy rotate-ip',
      'proxy set-geo <geo>',
      'proxy attach',
      'proxy setup',
      'proxy upstream <url>',
    ]) {
      assert.ok(names.includes(verb), verb);
    }
    assert.ok(help.environment.includes('ALUVIA_HOME'));
    assert.ok(help.environment.includes('ALUVIA_UPSTREAM'));
  });
});

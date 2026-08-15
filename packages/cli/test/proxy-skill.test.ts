import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledSkillPath, installProxySkill, skillInstallDirs } from '../src/proxy-skill.js';

describe('proxy skill install', () => {
  let home: string;
  const prevHome = process.env.HOME;
  const prevAluviaHome = process.env.ALUVIA_HOME;
  const prevSkillDirs = process.env.ALUVIA_SKILL_DIRS;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-skill-'));
    process.env.HOME = home;
    process.env.ALUVIA_HOME = path.join(home, '.aluvia');
    delete process.env.ALUVIA_SKILL_DIRS;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevAluviaHome === undefined) delete process.env.ALUVIA_HOME;
    else process.env.ALUVIA_HOME = prevAluviaHome;
    if (prevSkillDirs === undefined) delete process.env.ALUVIA_SKILL_DIRS;
    else process.env.ALUVIA_SKILL_DIRS = prevSkillDirs;
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('bundled skill exists and is the aluvia skill', () => {
    const src = bundledSkillPath();
    assert.ok(src);
    const body = fs.readFileSync(src, 'utf8');
    assert.match(body, /^name: aluvia$/m);
    assert.ok(!body.includes('aluvia-proxy'));
    assert.ok(body.includes('aluvia proxy-on'));
    assert.ok(body.includes('npx aluvia-cli setup --url'));
    assert.ok(body.includes('chromeCommand'));
    assert.ok(body.includes('Do not run setup again'));
    assert.ok(body.includes('aimed'));
    assert.ok(body.includes('When a workflow is blocked'));
    assert.ok(body.includes('aluvia status'));
    assert.ok(body.includes('Follow `next`'));
    assert.ok(body.includes('`what` explains every field'));
    assert.ok(body.includes('aluvia proxy-off'));
    assert.ok(body.includes('payment_required'));
    assert.ok(body.includes('aluvia auth --key'));
    assert.ok(body.includes('aluvia upstream <url>'));
    assert.ok(body.includes('Ask them in chat'));
    assert.ok(!body.includes('ALUVIA_API_KEY'));
    assert.ok(!body.includes('ALUVIA_UPSTREAM'));
    assert.ok(!body.includes('have them run'));
    assert.ok(!body.includes('policyCommand'));
    assert.ok(!body.includes('aluvia route'));
    assert.ok(!body.includes('git clone'));
    assert.ok(!body.includes('aluvia-grok-bot-install'));
    assert.ok(!body.includes('export ALUVIA_HOME'));
    assert.ok(!body.includes('Load unpacked'));
    assert.ok(!body.includes('net-internals'));
    assert.ok(!body.includes('last-connect'));
    const repoCopy = path.join(process.cwd(), '..', '..', 'skills', 'aluvia', 'SKILL.md');
    if (fs.existsSync(repoCopy)) {
      assert.strictEqual(body, fs.readFileSync(repoCopy, 'utf8'));
    }
  });

  test('installProxySkill writes SKILL.md to ALUVIA_SKILL_DIRS', () => {
    const destRoot = path.join(home, 'agents-skills');
    process.env.ALUVIA_SKILL_DIRS = destRoot;
    const result = installProxySkill();
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.skillPaths, [path.join(destRoot, 'aluvia', 'SKILL.md')]);
    const written = fs.readFileSync(result.skillPaths[0], 'utf8');
    assert.strictEqual(written, fs.readFileSync(bundledSkillPath()!, 'utf8'));
    assert.strictEqual(result.skill, written);
  });

  test('default dirs include ALUVIA_HOME/skills and ~/.agents/skills', () => {
    const dirs = skillInstallDirs();
    assert.ok(dirs.includes(path.join(home, '.aluvia', 'skills')));
    assert.ok(dirs.includes(path.join(home, '.agents', 'skills')));
  });
});

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
  const workspaceSkillDir = '/workspace/.agents/skills/aluvia';
  let workspaceSkillExisted: boolean;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aluvia-skill-'));
    process.env.HOME = home;
    process.env.ALUVIA_HOME = path.join(home, '.aluvia');
    delete process.env.ALUVIA_SKILL_DIRS;
    workspaceSkillExisted = fs.existsSync(workspaceSkillDir);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevAluviaHome === undefined) delete process.env.ALUVIA_HOME;
    else process.env.ALUVIA_HOME = prevAluviaHome;
    if (prevSkillDirs === undefined) delete process.env.ALUVIA_SKILL_DIRS;
    else process.env.ALUVIA_SKILL_DIRS = prevSkillDirs;
    fs.rmSync(home, { recursive: true, force: true });
    if (!workspaceSkillExisted && fs.existsSync(workspaceSkillDir)) {
      fs.rmSync(workspaceSkillDir, { recursive: true, force: true });
    }
  });

  test('bundled skill exists and is the aluvia skill', () => {
    const src = bundledSkillPath();
    assert.ok(src);
    const body = fs.readFileSync(src, 'utf8');
    assert.match(body, /^name: aluvia$/m);
    assert.ok(!body.includes('aluvia-proxy'));
    assert.ok(body.includes('aluvia proxy-on'));
    assert.ok(body.includes('npx aluvia-cli setup'));
    assert.ok(body.includes('chromeCommand'));
    assert.ok(body.includes('no-op'));
    assert.ok(body.includes('Idle is fine') || body.includes('Idle tabs stay aimed'));
    assert.ok(body.includes('One restart is expected'));
    assert.ok(body.includes('without quitting'));
    assert.ok(body.includes('aluvia setup'));
    assert.ok(body.includes('--url'));
    assert.ok(body.includes('chromeCommand'));
    assert.ok(body.includes('claim_url'));
    assert.ok(body.includes('aimed'));
    assert.ok(body.includes('When a workflow is blocked'));
    assert.ok(body.includes('aluvia status'));
    assert.ok(body.includes('Follow `next`'));
    assert.ok(body.includes('`what` explains every field'));
    assert.ok(body.includes('aluvia proxy-off'));
    assert.ok(body.includes('payment_required'));
    assert.ok(body.includes('aluvia auth <that key>'));
    assert.ok(body.includes('aluvia proxy-provider <url>'));
    assert.ok(body.includes('aluvia proxy-provider aluvia'));
    assert.ok(body.includes('aluvia auth login'));
    assert.ok(!body.includes('aluvia auth --key'));
    assert.ok(!body.includes('aluvia upstream'));
    assert.ok(!body.includes('aluvia session'));
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
    assert.ok(fs.existsSync(repoCopy), 'repo skills/aluvia/SKILL.md must exist');
    assert.ok(src && fs.existsSync(src), 'packages/cli/skills/aluvia/SKILL.md must exist');
    assert.strictEqual(body, fs.readFileSync(repoCopy, 'utf8'));
  });

  test('installProxySkill writes SKILL.md to ALUVIA_SKILL_DIRS', () => {
    const destRoot = path.join(home, 'agents-skills');
    process.env.ALUVIA_SKILL_DIRS = destRoot;
    const result = installProxySkill();
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.skillPaths, [path.join(destRoot, 'aluvia', 'SKILL.md')]);
    const written = fs.readFileSync(result.skillPaths[0], 'utf8');
    assert.strictEqual(written, fs.readFileSync(bundledSkillPath()!, 'utf8'));
    assert.ok(!('skill' in result));
  });

  test('default dirs always include ALUVIA_HOME/skills and ~/.agents/skills', () => {
    const dirs = skillInstallDirs();
    assert.ok(dirs.includes(path.join(home, '.aluvia', 'skills')));
    assert.ok(dirs.includes(path.join(home, '.agents', 'skills')));
    assert.ok(!dirs.includes(path.join(home, '.hermes', 'skills')));
    assert.ok(!dirs.includes(path.join(home, '.grok', 'skills')));
    assert.ok(!dirs.includes(path.join(home, '.claude', 'skills')));
    assert.ok(!dirs.includes(path.join(home, '.cursor', 'skills')));
    assert.ok(!dirs.includes(path.join(home, '.codex', 'skills')));
    assert.ok(!dirs.includes(path.join(home, '.openclaw', 'skills')));
    assert.ok(!dirs.includes(path.join(process.cwd(), '.grok', 'skills')));
    assert.ok(!dirs.includes(path.join(process.cwd(), '.claude', 'skills')));
    assert.ok(!dirs.includes(path.join(process.cwd(), '.agents', 'skills')));
  });

  test('default dirs include a host extra only when that agent home exists', () => {
    fs.mkdirSync(path.join(home, '.hermes'));
    fs.mkdirSync(path.join(home, '.openclaw'));
    const dirs = skillInstallDirs();
    assert.ok(dirs.includes(path.join(home, '.hermes', 'skills')));
    assert.ok(dirs.includes(path.join(home, '.openclaw', 'skills')));
    assert.ok(!dirs.includes(path.join(home, '.openclaw', 'workspace', 'skills')));
    assert.ok(!dirs.includes(path.join(home, '.claude', 'skills')));
  });

  test('missing ~/.hermes is not created and is not in skillPaths', () => {
    const hermesHome = path.join(home, '.hermes');
    const hermesSkill = path.join(hermesHome, 'skills', 'aluvia', 'SKILL.md');
    assert.ok(!fs.existsSync(hermesHome));
    const result = installProxySkill();
    assert.strictEqual(result.error, undefined);
    assert.ok(!result.skillPaths.includes(hermesSkill));
    assert.ok(!fs.existsSync(hermesHome));
  });

  test('existing ~/.hermes gets the skill', () => {
    const hermesHome = path.join(home, '.hermes');
    fs.mkdirSync(hermesHome);
    const hermesSkill = path.join(hermesHome, 'skills', 'aluvia', 'SKILL.md');
    const result = installProxySkill();
    assert.strictEqual(result.error, undefined);
    assert.ok(result.skillPaths.includes(hermesSkill));
    assert.ok(fs.existsSync(hermesSkill));
    assert.strictEqual(fs.readFileSync(hermesSkill, 'utf8'), fs.readFileSync(bundledSkillPath()!, 'utf8'));
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir } from './config.js';

const SKILL_REL = path.join('aluvia', 'SKILL.md');

// @ts-ignore - import.meta.url exists at runtime in ESM (the bin/main build)
const thisModuleDir = path.dirname(fileURLToPath(import.meta.url));

export function bundledSkillPath(): string | null {
  const here = thisModuleDir;
  const candidates = [
    path.join(here, '..', '..', 'skills', SKILL_REL),
    path.join(here, '..', 'skills', SKILL_REL),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function skillInstallDirs(): string[] {
  const override = (process.env.ALUVIA_SKILL_DIRS ?? '').trim();
  if (override) {
    return override
      .split(path.delimiter)
      .map((dir) => dir.trim())
      .filter((dir) => dir.length > 0);
  }

  const home = os.homedir();
  const dirs = [path.join(configDir(), 'skills'), path.join(home, '.agents', 'skills')];
  if (fs.existsSync('/workspace')) {
    dirs.push('/workspace/.agents/skills');
  }
  for (const extra of [
    path.join(home, '.grok', 'skills'),
    path.join(home, '.claude', 'skills'),
    path.join(home, '.cursor', 'skills'),
  ]) {
    if (fs.existsSync(path.dirname(extra))) dirs.push(extra);
  }
  return [...new Set(dirs)];
}

export function installProxySkill(): { skillPaths: string[]; skill?: string; error?: string } {
  const src = bundledSkillPath();
  if (!src) {
    return { skillPaths: [], error: 'bundled aluvia skill is missing from this CLI install' };
  }
  const body = fs.readFileSync(src);
  const skill = body.toString('utf8');
  const skillPaths: string[] = [];
  for (const dir of skillInstallDirs()) {
    const destDir = path.join(dir, 'aluvia');
    const dest = path.join(destDir, 'SKILL.md');
    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(dest, body);
      skillPaths.push(dest);
    } catch {
      // skip unwritable agent dirs
    }
  }
  return { skillPaths, skill };
}

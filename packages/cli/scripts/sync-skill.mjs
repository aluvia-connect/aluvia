import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(cliRoot, '..', '..');
const src = path.join(repoRoot, 'skills', 'aluvia', 'SKILL.md');
const destDir = path.join(cliRoot, 'skills', 'aluvia');
const dest = path.join(destDir, 'SKILL.md');

if (!fs.existsSync(src)) {
  console.error(`sync-skill: missing ${src}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('sync-skill: skills/aluvia/SKILL.md → packages/cli/skills/aluvia/SKILL.md');

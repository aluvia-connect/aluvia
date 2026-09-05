import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

execSync('node ./scripts/sync-skill.mjs', { cwd: cliRoot, stdio: 'inherit' });
// Do not publish JavaScript left over from source files removed since the last build.
fs.rmSync(path.join(cliRoot, 'dist'), { recursive: true, force: true });
execSync('npm run build', { cwd: cliRoot, stdio: 'inherit' });

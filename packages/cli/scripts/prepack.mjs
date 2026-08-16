import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

execSync('node ./scripts/sync-skill.mjs', { cwd: cliRoot, stdio: 'inherit' });
execSync('npm run build', { cwd: cliRoot, stdio: 'inherit' });

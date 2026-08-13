import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(cliRoot, 'package.json');
const backupPath = path.join(cliRoot, 'package.json.prepack');

if (!fs.existsSync(backupPath)) {
  console.log('postpack: no package.json.prepack; leaving package.json as-is');
  process.exit(0);
}
fs.writeFileSync(pkgPath, fs.readFileSync(backupPath, 'utf8'));
fs.rmSync(backupPath);
console.log('postpack: restored package.json');

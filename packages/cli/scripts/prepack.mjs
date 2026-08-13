import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(cliRoot, 'package.json');
const backupPath = path.join(cliRoot, 'package.json.prepack');

execSync('node ./scripts/vendor-sdk.mjs', { cwd: cliRoot, stdio: 'inherit' });
execSync('npm run build', { cwd: cliRoot, stdio: 'inherit' });

const raw = fs.readFileSync(pkgPath, 'utf8');
fs.writeFileSync(backupPath, raw);
const pkg = JSON.parse(raw);
const sdkPkg = JSON.parse(
  fs.readFileSync(path.join(cliRoot, 'vendor', 'aluvia-sdk', 'package.json'), 'utf8'),
);
pkg.dependencies = {
  ...(sdkPkg.dependencies ?? {}),
  ...(pkg.dependencies ?? {}),
  '@aluvia/sdk': 'file:./vendor/aluvia-sdk',
};
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('prepack: @aluvia/sdk → file:./vendor/aluvia-sdk; hoisted SDK runtime deps');

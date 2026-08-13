import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptsDir, '..');
const sdkRoot = path.resolve(cliRoot, '../sdk');
const dest = path.join(cliRoot, 'vendor', 'aluvia-sdk');

const copyNames = ['package.json', 'LICENSE', 'README.md', 'CHANGELOG.md', 'dist'];

execSync('npm run build', { cwd: sdkRoot, stdio: 'inherit' });

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

for (const name of copyNames) {
  const from = path.join(sdkRoot, name);
  if (!fs.existsSync(from)) {
    throw new Error(`Cannot vendor SDK: missing ${from}`);
  }
  fs.cpSync(from, path.join(dest, name), { recursive: true });
}

const pkgPath = path.join(dest, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.name !== '@aluvia/sdk') {
  throw new Error(`Vendored package name is ${pkg.name}, expected @aluvia/sdk`);
}
delete pkg.devDependencies;
delete pkg.peerDependencies;
delete pkg.peerDependenciesMeta;
delete pkg.scripts;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Vendored ${pkg.name}@${pkg.version} → ${dest}`);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-ignore - import.meta.url exists at runtime in ESM (the only build the bin/main uses)
const thisModuleDir = path.dirname(fileURLToPath(import.meta.url));

export function getCliLaunch(): { execPath: string; prefixArgs: string[]; script: string } {
  const js = path.join(thisModuleDir, 'cli.js');
  if (fs.existsSync(js)) {
    return { execPath: process.execPath, prefixArgs: [], script: js };
  }
  const ts = path.join(thisModuleDir, 'cli.ts');
  if (fs.existsSync(ts)) {
    return { execPath: process.execPath, prefixArgs: ['--import', 'tsx'], script: ts };
  }
  throw new Error(`Could not find cli.js or cli.ts in ${thisModuleDir}`);
}

#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { handleAccount } from './account.js';
import { handleAuth } from './auth.js';
import { handleGeos } from './geos.js';
import { handleProxy } from './proxy.js';
import { handleProxyDaemon } from './proxy-daemon.js';
import { PaymentRequiredError } from './net/errors.js';
import { pendingAluviaInstallBeacon } from './meta-aluvia-install.js';
import { isCapturing, OutputCapture } from './output-capture.js';

export function output(data: Record<string, unknown>, exitCode = 0): never {
  if (isCapturing()) {
    throw new OutputCapture(data, exitCode);
  }
  console.log(JSON.stringify(data));
  const pending = pendingAluviaInstallBeacon();
  if (pending) {
    // JSON is already on stdout. Stay alive until the fire-and-forget GET settles
    // so process.exit does not drop the Pixel request.
    void pending.finally(() => process.exit(exitCode));
    return undefined as never;
  }
  process.exit(exitCode);
}

const HELP_NEXT = 'These are the commands. Every command prints JSON. Follow next on the command you run.';

export function buildHelpJson(): {
  commands: Array<{ command: string; description: string; options: unknown[] }>;
} {
  return {
    commands: [
      {
        command: 'setup',
        description: 'Start the daemon and aim the GUI browser',
        options: [
          {
            flag: '--url <url>',
            description:
              'Required when Chrome is not already aimed. Open this page after the Chrome restart so a CONNECT can land.',
          },
        ],
      },
      {
        command: 'start',
        description: 'Start the local egress daemon',
        options: [],
      },
      {
        command: 'stop',
        description: 'Stop the local egress daemon',
        options: [],
      },
      {
        command: 'status',
        description: 'Show daemon status',
        options: [],
      },
      {
        command: 'proxy-on',
        description: 'Send all browser traffic through Aluvia',
        options: [
          {
            flag: '--geo <geo>',
            description: 'Pin this country (e.g. US). Omit to use every geo.',
          },
        ],
      },
      {
        command: 'proxy-off',
        description: 'Send browser traffic direct (daemon stays up)',
        options: [],
      },
      {
        command: 'rotate-ip',
        description: 'New exit IP (turns proxy on if needed)',
        options: [
          {
            flag: '--geo <geo>',
            description: 'Pin this country (e.g. US). Omit to use every geo.',
          },
        ],
      },
      {
        command: 'proxy-provider aluvia',
        description: 'Use the Aluvia network (default)',
        options: [],
      },
      {
        command: 'proxy-provider <url>',
        description: 'Use a proxy URL the human pasted instead of Aluvia',
        options: [],
      },
      {
        command: 'account',
        description: 'Show account info',
        options: [],
      },
      {
        command: 'account usage',
        description: 'Show usage stats',
        options: [
          { flag: '--start <ISO8601>', description: 'Start date filter' },
          { flag: '--end <ISO8601>', description: 'End date filter' },
        ],
      },
      {
        command: 'geos',
        description: 'List available geos',
        options: [],
      },
      {
        command: 'auth <key>',
        description: 'Save an API key the human pasted (never printed)',
        options: [],
      },
      {
        command: 'auth login',
        description: 'Wait until the human finishes claim_url (prints a URL only if none is pending)',
        options: [],
      },
      {
        command: 'auth status',
        description: 'Show whether you are authenticated (does not print the key)',
        options: [],
      },
      {
        command: 'help',
        description: 'Show this help',
        options: [{ flag: '--json', description: 'Accepted; help is always JSON' }],
      },
    ],
  };
}

export function handleHelp(): never {
  return output({ ...buildHelpJson(), next: HELP_NEXT });
}

function printHelpAndExit(_args: string[]): never {
  return handleHelp();
}

const PROXY_TOP_LEVEL = new Set([
  'setup',
  'start',
  'stop',
  'status',
  'proxy-on',
  'proxy-off',
  'rotate-ip',
  'proxy-provider',
]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? '';

  // Internal: --proxy-daemon mode (spawned by `start` in detached child)
  if (command === '--proxy-daemon') {
    await handleProxyDaemon(args.slice(1));
    return;
  }

  // Check for --help / -h anywhere in args (subcommand help)
  const wantsHelp = args.includes('--help') || args.includes('-h');

  if (command === 'account') {
    if (wantsHelp) printHelpAndExit(args);
    await handleAccount(args.slice(1));
  } else if (command === 'auth') {
    if (wantsHelp) printHelpAndExit(args);
    await handleAuth(args.slice(1));
  } else if (command === 'geos') {
    if (wantsHelp) printHelpAndExit(args);
    await handleGeos();
  } else if (PROXY_TOP_LEVEL.has(command)) {
    if (wantsHelp) printHelpAndExit(args);
    await handleProxy(args);
  } else if (command === 'help' || command === '--help' || command === '-h' || command === '') {
    printHelpAndExit(args);
  } else {
    output(
      {
        error: `Unknown command: '${command}'. Run "aluvia help" for usage.`,
        next: 'Run `aluvia help`.',
      },
      1,
    );
  }
}

// Only run CLI when this file is the direct entry point (not when imported by tests).
// Resolve process.argv[1] through any symlinks (e.g. npm's global bin -> dist/esm/cli.js)
// and compare to this module's URL. This is symlink-safe, unlike a filename regex which
// fails when launched via the extension-less `aluvia` bin symlink.
const entry = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
// @ts-ignore - import.meta.url exists at runtime in ESM (the only build the bin/main uses)
const isCli = entry === import.meta.url;
if (isCli) {
  main().catch(async (err) => {
    if (err instanceof PaymentRequiredError) {
      const { paymentRequiredPayload } = await import('./auth.js');
      output(await paymentRequiredPayload(err), 1);
    }
    output({ error: err.message }, 1);
  });
}

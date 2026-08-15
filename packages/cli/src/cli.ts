#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { handleOpenDaemon } from './open.js';
import { parseSessionArgs } from './session.js';
import type { ParsedSessionArgs } from './session.js';
import { handleAccount } from './account.js';
import { handleAuth } from './auth.js';
import { handleGeos } from './geos.js';
import { handleProxy } from './proxy.js';
import { handleProxyDaemon } from './proxy-daemon.js';
import { PaymentRequiredError, validateSessionName } from '@aluvia/sdk';
import { isCapturing, MCPOutputCapture } from './mcp-helpers.js';

export function output(data: Record<string, unknown>, exitCode = 0): never {
  if (isCapturing()) {
    throw new MCPOutputCapture(data, exitCode);
  }
  console.log(JSON.stringify(data));
  process.exit(exitCode);
}

function printHelp(toStderr = false): void {
  const log = toStderr ? console.error : console.log;
  log('Aluvia CLI\n');
  log(
    'A first setup starts a free trial (no API key). If the trial is used up, ask the human for an API key or their own proxy URL, then run `aluvia auth <key>` or `aluvia proxy-provider <url>`. Do not edit environment variables.\n',
  );
  log('Usage:');
  log('  aluvia setup --url <page>                   Start proxyd and aim the GUI browser');
  log('  aluvia start                                Start the local egress daemon');
  log('  aluvia stop                                 Stop the local egress daemon');
  log('  aluvia status                               Show daemon status');
  log(
    '  aluvia proxy-on [--geo <geo>]               Send all browser traffic through Aluvia (any geo unless --geo)',
  );
  log('  aluvia proxy-off                            Send browser traffic direct (daemon stays up)');
  log('  aluvia rotate-ip [--geo <geo>]              New exit IP from any geo (or --geo US)');
  log('  aluvia proxy-provider aluvia                 Use the Aluvia network (default)');
  log('  aluvia proxy-provider <url>                  Use a proxy URL the human pasted\n');
  log('  aluvia account                              Show account info');
  log('  aluvia account usage [options]              Show usage stats');
  log('  aluvia geos                                 List available geos\n');
  log('  aluvia auth <key>                           Save an API key the human pasted');
  log('  aluvia auth login                           Wait until the human finishes claim_url');
  log('  aluvia auth status                          Show whether you are authenticated');
  log('  aluvia help [--json]                        Show this help\n');
  log('setup:');
  log('  --url <url>                Blocked page to reopen after the one Chrome restart\n');
  log('proxy-on / rotate-ip:');
  log('  --geo <geo>                Pin this country (e.g. "US"). Omit to use every geo.\n');
  log('Account usage options:');
  log('  --start <ISO8601>          Start date filter');
  log('  --end <ISO8601>            End date filter\n');
  log('Environment:');
  log('  ALUVIA_API_KEY             Optional override. Agents should run `aluvia auth <key>`, not set this.');
  log(
    '  ALUVIA_UPSTREAM            Optional override. Agents should run `aluvia proxy-provider <url>`, not set this.',
  );
  log(
    '  ALUVIA_HOME                Optional. Default /workspace/.aluvia when /workspace exists, else ~/.aluvia.\n',
  );
  log('Output:');
  log('  All commands output JSON to stdout.');
}

export function buildHelpJson(): {
  commands: Array<{ command: string; description: string; options: unknown[] }>;
  environment: string[];
} {
  return {
    commands: [
      {
        command: 'setup',
        description: 'Start the daemon and aim the GUI browser',
        options: [
          {
            flag: '--url <url>',
            description: 'Blocked page to reopen after the one Chrome restart',
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
        options: [{ flag: '--json', description: 'Output help as JSON' }],
      },
    ],
    environment: ['ALUVIA_API_KEY', 'ALUVIA_HOME', 'ALUVIA_UPSTREAM'],
  };
}

function printHelpJson(): never {
  return output(buildHelpJson());
}

function printHelpAndExit(args: string[]): never {
  if (args.includes('--json')) {
    return printHelpJson();
  }
  printHelp();
  process.exit(0);
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

function parseDaemonArgs(args: string[]): ParsedSessionArgs {
  return parseSessionArgs(args);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? '';

  // Internal: --proxy-daemon mode (spawned by `proxy start` in detached child)
  if (command === '--proxy-daemon') {
    await handleProxyDaemon(args.slice(1));
    return;
  }

  // Internal: --daemon mode (spawned by `session start` in detached child)
  if (command === '--daemon') {
    const parsed = parseDaemonArgs(args.slice(1));

    if (parsed.sessionName && !validateSessionName(parsed.sessionName)) {
      output(
        {
          error: 'Invalid session name. Use only letters, numbers, hyphens, and underscores.',
        },
        1,
      );
    }

    if (!parsed.url) {
      return output({ error: 'URL is required for daemon mode.' }, 1);
    }

    await handleOpenDaemon({
      url: parsed.url,
      connectionId: parsed.connectionId,
      headless: !parsed.headed,
      sessionName: parsed.sessionName,
      autoUnblock: parsed.autoUnblock,
      disableBlockDetection: parsed.disableBlockDetection,
      run: parsed.run,
    });
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
    output({ error: `Unknown command: '${command}'. Run "aluvia help" for usage.` }, 1);
  }
}

// Only run CLI when this file is the direct entry point (not when imported by MCP server).
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

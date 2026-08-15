#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { handleOpenDaemon } from './open.js';
import { handleSession, parseSessionArgs } from './session.js';
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
    'A first setup starts a free trial (no API key). If the trial is used up, ask the human for an API key or their own proxy URL, then run `aluvia auth --key <key>` or `aluvia upstream <url>`. Do not edit environment variables.\n',
  );
  log('Usage:');
  log('  aluvia setup --url <page>                   Start proxyd and aim the GUI browser');
  log('  aluvia start                                Start the local egress daemon');
  log('  aluvia stop                                 Stop the local egress daemon');
  log('  aluvia status                               Show daemon status');
  log('  aluvia proxy-on [--geo <geo>]               Send all browser traffic through Aluvia');
  log('  aluvia proxy-off                            Send browser traffic direct (daemon stays up)');
  log('  aluvia rotate-ip [--geo <geo>]              New exit IP (turns proxy on if needed)');
  log('  aluvia upstream <url>                       Use your own proxy (no Aluvia account)\n');
  log('  aluvia session start <url> [options]       Start a headless browser session');
  log('  aluvia session close [options]              Stop a browser session');
  log('  aluvia session list                         List active browser sessions');
  log('  aluvia session get [options]                Get session details and proxy URLs');
  log('  aluvia session rotate-ip [options]          Rotate IP on a running session');
  log('  aluvia session set-geo <geo> [options]      Set target geo on a running session');
  log('  aluvia session set-rules <rules> [options]  Set routing rules on a running session\n');
  log('  aluvia account                              Show account info');
  log('  aluvia account usage [options]              Show usage stats');
  log('  aluvia geos                                 List available geos\n');
  log('  aluvia auth --key <key>                     Save an API key the human pasted');
  log('  aluvia auth                                 Human opens the printed link on their machine');
  log('  aluvia auth status                          Show whether you are authenticated');
  log('  aluvia auth logout                          Remove the stored API key');
  log('  aluvia help [--json]                        Show this help\n');
  log('Session start options:');
  log('  --connection-id <id>       Use a specific connection ID');
  log('  --headful                  Run browser in headful mode');
  log('  --browser-session <name>   Name for this session (auto-generated if omitted)');
  log('  --auto-unblock             Auto-detect blocks and reload through Aluvia');
  log('  --disable-block-detection  Disable block detection entirely');
  log('  --run <script>             Run a script with page, browser, context injected\n');
  log('Session close options:');
  log('  --browser-session <name>   Close a specific session');
  log('  --all                      Close all sessions\n');
  log('Session targeting (get, rotate-ip, set-geo, set-rules):');
  log('  --browser-session <name>   Target a specific session (auto-selects if only one)\n');
  log('Session set-rules:');
  log('  <rules>                    Comma-separated rules to append (e.g. "a.com,b.com")');
  log('  --remove <rules>           Remove specific rules instead of appending\n');
  log('Session set-geo:');
  log('  <geo>                      Geo code to set (e.g. "US")');
  log('  --clear                    Clear target geo\n');
  log('setup:');
  log('  --url <url>                Blocked page to reopen after the one Chrome restart\n');
  log('proxy-on / rotate-ip:');
  log('  --geo <geo>                Pin exit geo (e.g. "US"). `--geo all` uses every geo.\n');
  log('Account usage options:');
  log('  --start <ISO8601>          Start date filter');
  log('  --end <ISO8601>            End date filter\n');
  log('Environment:');
  log('  ALUVIA_API_KEY             Optional override. Agents should run `aluvia auth --key`, not set this.');
  log(
    '  ALUVIA_UPSTREAM            Optional override. Agents should run `aluvia upstream <url>`, not set this.',
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
        command: 'session start <url>',
        description: 'Start a browser session',
        options: [
          {
            flag: '--connection-id <id>',
            description: 'Use a specific connection ID',
          },
          { flag: '--headful', description: 'Run browser in headful mode' },
          {
            flag: '--browser-session <name>',
            description: 'Name for this session (auto-generated if omitted)',
          },
          {
            flag: '--auto-unblock',
            description: 'Auto-detect blocks and reload through Aluvia',
          },
          {
            flag: '--disable-block-detection',
            description: 'Disable block detection entirely',
          },
          {
            flag: '--run <script>',
            description: 'Run a script with page, browser, context injected',
          },
        ],
      },
      {
        command: 'session close',
        description: 'Stop a browser session',
        options: [
          {
            flag: '--browser-session <name>',
            description: 'Close a specific session',
          },
          { flag: '--all', description: 'Close all sessions' },
        ],
      },
      {
        command: 'session list',
        description: 'List active browser sessions',
        options: [],
      },
      {
        command: 'session get',
        description: 'Get session details and proxy URLs',
        options: [
          {
            flag: '--browser-session <name>',
            description: 'Target a specific session (auto-selects if only one)',
          },
        ],
      },
      {
        command: 'session rotate-ip',
        description: 'Rotate IP on a running session',
        options: [
          {
            flag: '--browser-session <name>',
            description: 'Target a specific session (auto-selects if only one)',
          },
        ],
      },
      {
        command: 'session set-geo <geo>',
        description: 'Set target geo on a running session',
        options: [
          {
            flag: '--browser-session <name>',
            description: 'Target a specific session (auto-selects if only one)',
          },
          { flag: '--clear', description: 'Clear target geo' },
        ],
      },
      {
        command: 'session set-rules <rules>',
        description: 'Set routing rules on a running session',
        options: [
          {
            flag: '--browser-session <name>',
            description: 'Target a specific session (auto-selects if only one)',
          },
          {
            flag: '--remove <rules>',
            description: 'Remove specific rules instead of appending',
          },
        ],
      },
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
            description: 'Use an IP in this geo. `--geo all` uses every geo.',
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
            description: 'Rotate in this geo (or the previously pinned geo). `--geo all` uses every geo.',
          },
        ],
      },
      {
        command: 'upstream <url>',
        description: 'Use your own proxy instead of Aluvia (or --clear)',
        options: [{ flag: '--clear', description: 'Remove the saved upstream' }],
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
        command: 'auth --key <key>',
        description: 'Save an API key the human pasted (never printed)',
        options: [],
      },
      {
        command: 'auth',
        description: 'Log in to claim a trial or buy data (human opens the printed link)',
        options: [],
      },
      {
        command: 'auth status',
        description: 'Show whether you are authenticated (does not print the key)',
        options: [],
      },
      {
        command: 'auth logout',
        description: 'Remove the stored API key',
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
  'attach',
  'upstream',
  'rotate-ip',
  'set-geo',
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

  if (command === 'session') {
    if (wantsHelp) printHelpAndExit(args);
    await handleSession(args.slice(1));
  } else if (command === 'account') {
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
  main().catch((err) => {
    if (err instanceof PaymentRequiredError) {
      output(
        {
          error: err.message,
          code: 'payment_required',
          claim_url: err.claimUrl,
        },
        1,
      );
    }
    output({ error: err.message }, 1);
  });
}

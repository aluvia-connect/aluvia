#!/usr/bin/env node

import { handleOpenDaemon } from './open.js';
import { handleSession, parseSessionArgs } from './session.js';
import type { ParsedSessionArgs } from './session.js';
import { handleAccount } from './account.js';
import { handleAuth } from './auth.js';
import { handleGeos } from './geos.js';
import { validateSessionName } from '@aluvia/sdk';
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
  log('Usage:');
  log('  aluvia session start <url> [options]       Start a browser session');
  log('  aluvia session close [options]              Stop a browser session');
  log('  aluvia session list                         List active browser sessions');
  log('  aluvia session get [options]                Get session details and proxy URLs');
  log('  aluvia session rotate-ip [options]          Rotate IP on a running session');
  log('  aluvia session set-geo <geo> [options]      Set target geo on a running session');
  log('  aluvia session set-rules <rules> [options]  Set routing rules on a running session\n');
  log('  aluvia account                              Show account info');
  log('  aluvia account usage [options]              Show usage stats');
  log('  aluvia geos                                 List available geos\n');
  log('  aluvia auth                                 Log in and store your API key');
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
  log('Account usage options:');
  log('  --start <ISO8601>          Start date filter');
  log('  --end <ISO8601>            End date filter\n');
  log('Environment:');
  log('  ALUVIA_API_KEY        Optional. Takes precedence over the key stored by `aluvia auth`.\n');
  log('Output:');
  log('  All commands output JSON to stdout.');
}

function printHelpJson(): never {
  return output({
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
        command: 'auth',
        description: 'Log in and store your API key (open the printed link in any browser)',
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
  });
}

function printHelpAndExit(args: string[]): never {
  if (args.includes('--json')) {
    return printHelpJson();
  }
  printHelp();
  process.exit(0);
}

function parseDaemonArgs(args: string[]): ParsedSessionArgs {
  return parseSessionArgs(args);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? '';

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
  } else if (command === 'help' || command === '--help' || command === '-h' || command === '') {
    printHelpAndExit(args);
  } else {
    output({ error: `Unknown command: '${command}'. Run "aluvia help" for usage.` }, 1);
  }
}

// Only run CLI when this file is the direct entry point (not when imported by MCP server).
// Check if process.argv[1] resolves to this CLI file rather than another entry point.
const isCli = process.argv[1]?.match(/(?:cli)\.[jt]s$/);
if (isCli) {
  main().catch((err) => {
    output({ error: err.message }, 1);
  });
}

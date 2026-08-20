import { requireApi } from './api-helpers.js';
import { output } from './cli.js';

export async function handleAccount(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand) {
    const api = requireApi();
    const account = await api.account.get();
    return output({ account, next: 'This is account data. For the proxy, run `aluvia status`.' });
  }

  if (subcommand === 'usage') {
    let start: string | undefined;
    let end: string | undefined;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--start' && args[i + 1]) {
        start = args[i + 1];
        i++;
      } else if (args[i] === '--end' && args[i + 1]) {
        end = args[i + 1];
        i++;
      }
    }

    const api = requireApi();
    const usage = await api.account.usage.get({ start, end });
    return output({ usage, next: 'This is usage data. For the proxy, run `aluvia status`.' });
  }

  return output(
    {
      error: `Unknown account subcommand: '${subcommand}'.`,
      next: 'Run `aluvia account` or `aluvia account usage`.',
    },
    1,
  );
}

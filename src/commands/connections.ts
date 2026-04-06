import { Command } from 'commander';
import { scrapeRecentConnections } from '../browser/linkedin';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';

export function registerConnectionsCommands(program: Command): void {
  program
    .command('connections')
    .description('List your recent LinkedIn connections')
    .option('--limit <n>', 'Number of connections to return', '20')
    .action(async (opts) => {
      const { pretty } = getContext();
      try {
        const limit = parseInt(opts.limit, 10);
        const connections = await scrapeRecentConnections(limit);
        outputJson({ connections }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

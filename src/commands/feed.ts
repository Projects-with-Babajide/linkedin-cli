import { Command } from 'commander';
import { scrapeFeed } from '../browser/linkedin';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';

export function registerFeedCommand(program: Command): void {
  program
    .command('feed')
    .description('Read your LinkedIn home feed')
    .option('--limit <n>', 'Number of posts to return', '20')
    .action(async (opts) => {
      const { pretty } = getContext();
      try {
        const limit = parseInt(opts.limit, 10);
        const posts = await scrapeFeed(limit);
        outputJson({ posts }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

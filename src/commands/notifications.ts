import { Command } from 'commander';
import { scrapeNotifications } from '../browser/linkedin';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';

export function registerNotificationsCommand(program: Command): void {
  program
    .command('notifications')
    .description('Read your LinkedIn notifications')
    .option('--limit <n>', 'Number of notifications to return', '30')
    .option('--unread', 'Only show unread notifications', false)
    .action(async (opts) => {
      const { pretty } = getContext();
      try {
        const limit = parseInt(opts.limit, 10);
        const unreadOnly = Boolean(opts.unread);
        const notifications = await scrapeNotifications(limit, unreadOnly);
        outputJson({ notifications }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

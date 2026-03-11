import { Command } from 'commander';
import { scrapeMessageThreads, scrapeThread, sendMessage, startNewThread } from '../browser/linkedin';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';

export function registerMessagesCommands(program: Command): void {
  const messages = program.command('messages').description('Read and send LinkedIn messages');

  messages
    .command('list')
    .description('List recent message threads')
    .option('--limit <n>', 'Number of threads to return', '20')
    .option('--unread', 'Only show unread threads')
    .action(async (opts) => {
      const { pretty } = getContext();
      try {
        const limit = parseInt(opts.limit, 10);
        let threads = await scrapeMessageThreads(limit);
        if (opts.unread) threads = threads.filter((t) => t.unread);
        outputJson({ threads }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  messages
    .command('read <threadId>')
    .description('Read a message thread')
    .option('--limit <n>', 'Number of messages to return', '50')
    .action(async (threadId, opts) => {
      const { pretty } = getContext();
      try {
        const limit = parseInt(opts.limit, 10);
        const msgs = await scrapeThread(threadId, limit);
        outputJson({ threadId, messages: msgs }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  messages
    .command('send <threadId>')
    .description('Send a message to an existing thread')
    .requiredOption('--message <text>', 'Message body')
    .action(async (threadId, opts) => {
      const { pretty } = getContext();
      try {
        await sendMessage(threadId, opts.message);
        outputJson({ sent: true, threadId }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  messages
    .command('new')
    .description('Start a new message thread')
    .requiredOption('--to <name>', 'Recipient name or profile URL')
    .requiredOption('--message <text>', 'Message body')
    .action(async (opts) => {
      const { pretty } = getContext();
      try {
        const threadId = await startNewThread(opts.to, opts.message);
        outputJson({ sent: true, threadId }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

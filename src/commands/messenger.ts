import { Command } from 'commander';
import { listChats, readChat, sendMessengerMessage } from '../browser/messenger';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';

export function registerMessengerCommands(program: Command): void {
  const ms = program.command('messenger').description('Read and send Facebook Messenger messages');

  ms.command('chats')
    .description('List recent Messenger conversations')
    .option('--limit <n>', 'Number of conversations to return', '20')
    .option('--unread', 'Only show conversations with unread messages')
    .action(async (opts) => {
      const { pretty } = getContext();
      try {
        const limit = parseInt(opts.limit, 10);
        const chats = await listChats(limit, Boolean(opts.unread));
        outputJson({ chats }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  ms.command('read <chat>')
    .description('Read messages from a Messenger conversation by name')
    .option('--limit <n>', 'Number of recent messages to return', '50')
    .action(async (chat, opts) => {
      const { pretty } = getContext();
      try {
        const limit = parseInt(opts.limit, 10);
        const messages = await readChat(chat, limit);
        outputJson({ chat, messages }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  ms.command('send <chat>')
    .description('Send a message to a Messenger conversation by name')
    .requiredOption('--message <text>', 'Message body')
    .action(async (chat, opts) => {
      const { pretty } = getContext();
      try {
        await sendMessengerMessage(chat, opts.message);
        outputJson({ sent: true, chat }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

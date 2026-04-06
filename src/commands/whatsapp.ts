import { Command } from 'commander';
import { listChats, readChat, sendWhatsAppMessage } from '../browser/whatsapp';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';

export function registerWhatsAppCommands(program: Command): void {
  const wa = program.command('whatsapp').description('Read and send WhatsApp messages');

  wa.command('chats')
    .description('List recent WhatsApp chats')
    .option('--limit <n>', 'Number of chats to return', '20')
    .option('--unread', 'Only show chats with unread messages')
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

  wa.command('read <chat>')
    .description('Read messages from a WhatsApp chat by name')
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

  wa.command('send <chat>')
    .description('Send a message to a WhatsApp chat by name')
    .requiredOption('--message <text>', 'Message body')
    .action(async (chat, opts) => {
      const { pretty } = getContext();
      try {
        await sendWhatsAppMessage(chat, opts.message);
        outputJson({ sent: true, chat }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

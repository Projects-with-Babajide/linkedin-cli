import { Command } from 'commander';
import { requireValidTokens } from '../api/client';
import { createTextPost, commentOnPost } from '../api/posts';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';
import { readStdin } from '../utils/stdin';

export function registerPostCommands(program: Command): void {
  const post = program.command('post').description('Create and interact with LinkedIn posts');

  post
    .command('create')
    .description('Create a new LinkedIn post')
    .option('--text <string>', 'Post body text')
    .action(async (opts) => {
      const { pretty } = getContext();
      try {
        let text: string = opts.text ?? '';
        if (!text) text = await readStdin();
        if (!text) {
          throw new Error('Post text is required. Use --text "..." or pipe text via stdin.');
        }
        const tokens = await requireValidTokens();
        const result = await createTextPost(text, tokens);
        outputJson({ id: result.id }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  post
    .command('comment <urn>')
    .description('Comment on a LinkedIn post')
    .option('--text <string>', 'Comment text')
    .action(async (urn, opts) => {
      const { pretty } = getContext();
      try {
        let text: string = opts.text ?? '';
        if (!text) text = await readStdin();
        if (!text) {
          throw new Error('Comment text is required. Use --text "..." or pipe text via stdin.');
        }
        const tokens = await requireValidTokens();
        const result = await commentOnPost(urn, text, tokens);
        outputJson({ id: result.id }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

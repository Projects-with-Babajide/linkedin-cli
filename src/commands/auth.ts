import { Command } from 'commander';
import { requireConfig } from '../storage/config';
import { startOAuthFlow } from '../auth/oauth';
import { saveTokens, loadTokens, clearTokens, clearCookies } from '../storage/keytar-store';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Manage LinkedIn authentication');

  auth
    .command('login')
    .description('Authenticate with LinkedIn via OAuth')
    .action(async () => {
      const { pretty } = getContext();
      try {
        const config = await requireConfig();
        process.stderr.write('Opening browser for LinkedIn authentication...\n');
        const tokens = await startOAuthFlow(config);
        await saveTokens(tokens);
        outputJson(
          { message: 'Authenticated successfully', expiresAt: new Date(tokens.expiresAt).toISOString() },
          pretty
        );
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  auth
    .command('status')
    .description('Show current authentication status')
    .action(async () => {
      const { pretty } = getContext();
      try {
        const tokens = await loadTokens();
        if (!tokens) {
          outputJson({ authenticated: false }, pretty);
          return;
        }
        const expired = tokens.expiresAt < Date.now();
        outputJson({
          authenticated: true,
          expired,
          expiresAt: new Date(tokens.expiresAt).toISOString(),
        }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  auth
    .command('logout')
    .description('Clear stored credentials')
    .action(async () => {
      const { pretty } = getContext();
      try {
        await clearTokens();
        await clearCookies();
        outputJson({ message: 'Logged out successfully' }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

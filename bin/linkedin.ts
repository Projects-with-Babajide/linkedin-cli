#!/usr/bin/env node
import { Command } from 'commander';
import { setContext } from '../src/utils/context';
import { checkNotRoot } from '../src/utils/security';
import { readConfig } from '../src/storage/config';
import { registerAuthCommands } from '../src/commands/auth';
import { registerProfileCommand } from '../src/commands/profile';
import { registerMessagesCommands } from '../src/commands/messages';
import { registerFeedCommand } from '../src/commands/feed';
import { registerSearchCommands } from '../src/commands/search';
import { registerPostCommands } from '../src/commands/post';

checkNotRoot();

const program = new Command();

program
  .name('link-pulse')
  .version('0.1.0')
  .description('Feel the pulse of your professional network')
  .option('--pretty', 'Human-readable formatted output', false)
  .option('--json', 'Force JSON output (default)', false)
  .option('--debug', 'Verbose debug logging', false)
  .option('--no-cache', 'Skip local cache, always fetch fresh')
  .option('--headless', 'Run browser in headless mode', false);

program.hook('preAction', async (_thisCommand, actionCommand) => {
  const opts = program.opts();
  const config = await readConfig();
  const headlessFlag = opts['headless'] as boolean;
  // --headless flag explicitly passed takes precedence; otherwise fall back to config, then false
  const headless = headlessFlag || config?.headless === true;
  setContext({
    pretty: Boolean(opts['pretty']),
    json: Boolean(opts['json']),
    debug: Boolean(opts['debug']),
    noCache: opts['cache'] === false,
    headless,
  });
  if (opts['debug']) {
    process.stderr.write(`[debug] command: ${actionCommand.name()}\n`);
  }
});

registerAuthCommands(program);
registerProfileCommand(program);
registerMessagesCommands(program);
registerFeedCommand(program);
registerSearchCommands(program);
registerPostCommands(program);

program.parseAsync(process.argv);

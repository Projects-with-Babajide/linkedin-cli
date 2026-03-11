import { Command } from 'commander';
import { setContext } from '../src/utils/context';
import { registerAuthCommands } from '../src/commands/auth';
import { registerProfileCommand } from '../src/commands/profile';

// Root guard
if (process.platform !== 'win32' && process.getuid?.() === 0) {
  process.stderr.write(JSON.stringify({ success: false, error: { code: 'CONFIG_ERROR', message: 'Refusing to run as root' } }) + '\n');
  process.exit(1);
}

const program = new Command();

program
  .name('linkedin')
  .version('0.1.0')
  .description('Personal LinkedIn CLI')
  .option('--pretty', 'Human-readable formatted output', false)
  .option('--json', 'Force JSON output (default)', false)
  .option('--debug', 'Verbose debug logging', false)
  .option('--no-cache', 'Skip local cache, always fetch fresh')
  .option('--headless', 'Run browser in headless mode', false);

program.hook('preAction', (_thisCommand, actionCommand) => {
  const opts = program.opts();
  setContext({
    pretty: Boolean(opts['pretty']),
    json: Boolean(opts['json']),
    debug: Boolean(opts['debug']),
    noCache: opts['cache'] === false,
    headless: Boolean(opts['headless']),
  });
  if (opts['debug']) {
    process.stderr.write(`[debug] command: ${actionCommand.name()}\n`);
  }
});

registerAuthCommands(program);
registerProfileCommand(program);

program.parseAsync(process.argv);

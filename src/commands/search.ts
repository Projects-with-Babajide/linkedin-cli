import { Command } from 'commander';
import { searchPosts, searchPeople, searchCompanies } from '../browser/linkedin';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';

export function registerSearchCommands(program: Command): void {
  const search = program.command('search').description('Search LinkedIn');

  search
    .command('posts <query>')
    .description('Search LinkedIn posts')
    .option('--limit <n>', 'Number of results', '10')
    .action(async (query, opts) => {
      const { pretty } = getContext();
      try {
        const results = await searchPosts(query, parseInt(opts.limit, 10));
        outputJson({ query, results }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  search
    .command('people <query>')
    .description('Search LinkedIn people')
    .option('--limit <n>', 'Number of results', '10')
    .action(async (query, opts) => {
      const { pretty } = getContext();
      try {
        const results = await searchPeople(query, parseInt(opts.limit, 10));
        outputJson({ query, results }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });

  search
    .command('companies <query>')
    .description('Search LinkedIn companies')
    .option('--limit <n>', 'Number of results', '10')
    .action(async (query, opts) => {
      const { pretty } = getContext();
      try {
        const results = await searchCompanies(query, parseInt(opts.limit, 10));
        outputJson({ query, results }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

import { CliError } from '../types/index';
import { CliException, ErrorCode, toCliError } from './errors';

export function outputJson<T>(data: T, pretty: boolean): void {
  process.stdout.write(JSON.stringify({ success: true, data }, null, pretty ? 2 : 0) + '\n');
}

export function outputError(error: CliError, pretty: boolean): void {
  process.stderr.write(JSON.stringify({ success: false, error }, null, pretty ? 2 : 0) + '\n');
}

export function handleCommandError(e: unknown, pretty: boolean): never {
  const error = toCliError(e);
  outputError(error, pretty);
  if (e instanceof CliException) {
    if (e.code === ErrorCode.AUTH_REQUIRED) process.exit(2);
    if (e.code === ErrorCode.LINKEDIN_BLOCKED || e.code === ErrorCode.NETWORK_ERROR) process.exit(3);
  }
  process.exit(1);
}

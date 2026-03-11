import { getContext } from './context';

export function debug(...args: unknown[]): void {
  if (getContext().debug) {
    process.stderr.write(`[debug] ${args.map(String).join(' ')}\n`);
  }
}

export function warn(...args: unknown[]): void {
  process.stderr.write(`[warn] ${args.map(String).join(' ')}\n`);
}

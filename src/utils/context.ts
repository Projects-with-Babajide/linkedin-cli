export interface CliContext {
  pretty: boolean;
  json: boolean;
  debug: boolean;
  noCache: boolean;
  headless: boolean;
}

let ctx: CliContext = {
  pretty: false,
  json: false,
  debug: false,
  noCache: false,
  headless: false,
};

export function setContext(c: Partial<CliContext>): void {
  ctx = { ...ctx, ...c };
}

export function getContext(): CliContext {
  return ctx;
}

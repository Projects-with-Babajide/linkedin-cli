import { CliError } from '../types/index';

export enum ErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  LINKEDIN_BLOCKED = 'LINKEDIN_BLOCKED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  SELECTOR_ERROR = 'SELECTOR_ERROR',
  CONFIG_ERROR = 'CONFIG_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class CliException extends Error {
  code: ErrorCode;
  details?: unknown;

  constructor(message: string, code: ErrorCode, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'CliException';
  }
}

export function toCliError(e: unknown): CliError {
  if (e instanceof CliException) {
    return { code: e.code, message: e.message, details: e.details };
  }
  if (e instanceof Error) {
    return { code: ErrorCode.UNKNOWN, message: e.message };
  }
  return { code: ErrorCode.UNKNOWN, message: String(e) };
}

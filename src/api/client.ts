import { AuthTokens } from '../types/index';
import { CliException, ErrorCode } from '../utils/errors';
import { loadTokens } from '../storage/keytar-store';
import { debug } from '../utils/logger';

export async function requireValidTokens(): Promise<AuthTokens> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new CliException('Not authenticated. Run: linkedin auth login', ErrorCode.AUTH_REQUIRED);
  }
  if (tokens.expiresAt < Date.now()) {
    throw new CliException('Token expired. Run: linkedin auth login', ErrorCode.AUTH_REQUIRED);
  }
  return tokens;
}

export async function apiGet<T>(url: string, tokens: AuthTokens): Promise<T> {
  debug('apiGet:', url);
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'LinkedIn-Version': '202501',
    },
  });
  debug('apiGet response:', res.status);
  if (!res.ok) {
    const body = await res.text();
    throw new CliException(
      `LinkedIn API error ${res.status}: ${body}`,
      ErrorCode.NETWORK_ERROR,
      { status: res.status, body }
    );
  }
  return res.json() as Promise<T>;
}

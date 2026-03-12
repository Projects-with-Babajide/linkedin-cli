import * as http from 'http';
import * as crypto from 'crypto';
import open from 'open';
import { AuthTokens, CliConfig } from '../types/index';
import { CliException, ErrorCode } from '../utils/errors';

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

export async function startOAuthFlow(config: CliConfig): Promise<AuthTokens> {
  const state = crypto.randomBytes(16).toString('hex');

  const port = config.redirectPort || 8765;
  const redirectUri = `http://localhost:${port}/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
  });

  const authUrl = `${LINKEDIN_AUTH_URL}?${params.toString()}`;

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url!, `http://localhost:${port}`);
      if (reqUrl.pathname !== '/callback') return;

      const returnedState = reqUrl.searchParams.get('state');
      const returnedCode = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Authenticated! You can close this tab.</h1></body></html>');
      server.close();

      if (error) return reject(new CliException(`OAuth error: ${error}`, ErrorCode.AUTH_REQUIRED));
      if (returnedState !== state) return reject(new CliException('State mismatch', ErrorCode.AUTH_REQUIRED));
      if (!returnedCode) return reject(new CliException('No code returned', ErrorCode.AUTH_REQUIRED));

      resolve(returnedCode);
    });

    server.listen(port, () => {
      open(authUrl).catch(() => {
        process.stderr.write(`Open this URL in your browser:\n${authUrl}\n`);
      });
    });

    server.on('error', (err) => reject(err));
  });

  const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new CliException(`Token exchange failed: ${body}`, ErrorCode.AUTH_REQUIRED);
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    expires_in: number;
    scope: string;
    refresh_token?: string;
  };

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    scope: tokenData.scope,
  };
}

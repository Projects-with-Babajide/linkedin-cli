export interface CliConfig {
  clientId: string;
  clientSecret: string;
  redirectPort: number;
  headless?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
}

export interface StoredSession {
  tokens: AuthTokens;
  cookieState?: string;
}

export interface CliError {
  code: string;
  message: string;
  details?: unknown;
}

export interface JsonOutput<T> {
  success: boolean;
  data?: T;
  error?: CliError;
}

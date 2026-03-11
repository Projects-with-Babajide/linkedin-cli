import { Command } from 'commander';
import { requireValidTokens, apiGet } from '../api/client';
import { outputJson, handleCommandError } from '../utils/output';
import { getContext } from '../utils/context';

interface LinkedInUserInfo {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  picture?: string;
  email?: string;
}

export function registerProfileCommand(program: Command): void {
  program
    .command('profile')
    .description('Show your LinkedIn profile')
    .action(async () => {
      const { pretty } = getContext();
      try {
        const tokens = await requireValidTokens();
        const userInfo = await apiGet<LinkedInUserInfo>(
          'https://api.linkedin.com/v2/userinfo',
          tokens
        );
        outputJson({
          id: userInfo.sub,
          name: userInfo.name,
          email: userInfo.email,
          picture: userInfo.picture,
        }, pretty);
      } catch (e) {
        handleCommandError(e, getContext().pretty);
      }
    });
}

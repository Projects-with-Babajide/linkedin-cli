import { AuthTokens } from '../types/index';
import { CliException, ErrorCode } from '../utils/errors';

async function getAuthorUrn(tokens: AuthTokens): Promise<string> {
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'LinkedIn-Version': '202501',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new CliException(`Failed to get user info: ${body}`, ErrorCode.NETWORK_ERROR);
  }
  const data = await res.json() as { sub: string };
  return `urn:li:person:${data.sub}`;
}

export async function createTextPost(text: string, tokens: AuthTokens): Promise<{ id: string }> {
  const authorUrn = await getAuthorUrn(tokens);

  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202501',
    },
    body: JSON.stringify({
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new CliException(
      `Failed to create post: ${body}`,
      ErrorCode.NETWORK_ERROR,
      { status: res.status, body }
    );
  }

  const data = await res.json() as { id: string };
  return { id: data.id };
}

export async function commentOnPost(
  postUrn: string,
  text: string,
  tokens: AuthTokens
): Promise<{ id: string }> {
  const authorUrn = await getAuthorUrn(tokens);
  const encodedUrn = encodeURIComponent(postUrn);

  const res = await fetch(`https://api.linkedin.com/v2/socialActions/${encodedUrn}/comments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202501',
    },
    body: JSON.stringify({
      actor: authorUrn,
      message: { text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new CliException(
      `Failed to post comment: ${body}`,
      ErrorCode.NETWORK_ERROR,
      { status: res.status, body }
    );
  }

  const data = await res.json() as { id: string };
  return { id: data.id };
}

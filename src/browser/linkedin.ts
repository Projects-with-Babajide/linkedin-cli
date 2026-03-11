import { createBrowserSession, closeBrowserSession } from './session';
import { randomDelay, safeClick, checkForBlock, ensureLoggedIn } from './helpers';
import { CliException, ErrorCode } from '../utils/errors';
import { getCached, setCached } from '../storage/cache';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MessageThread {
  id: string;
  participantName: string;
  snippet: string;
  timestamp: string;
  unread: boolean;
}

export interface Message {
  sender: string;
  body: string;
  timestamp: string;
  isMe: boolean;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function scrapeMessageThreads(limit: number): Promise<MessageThread[]> {
  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded' });
    await randomDelay();

    // Wait for conversation list
    try {
      await session.page.waitForSelector('.msg-conversations-container__conversations-list', { timeout: 15000 });
    } catch {
      await session.page.waitForSelector('[data-view-name="message-list-item"]', { timeout: 10000 });
    }

    await checkForBlock(session.page);

    const threads = await session.page.evaluate(() => {
      const results: Array<{
        id: string;
        participantName: string;
        snippet: string;
        timestamp: string;
        unread: boolean;
      }> = [];

      // Try multiple selector strategies
      const items = document.querySelectorAll(
        '.msg-conversation-listitem, [data-view-name="message-list-item"], .msg-conversations-container__pillar'
      );

      items.forEach((item) => {
        try {
          // Extract thread ID from link href
          const link = item.querySelector('a[href*="/messaging/thread/"]') as HTMLAnchorElement;
          const href = link?.href ?? '';
          const idMatch = href.match(/\/messaging\/thread\/([^/]+)/);
          const id = idMatch ? idMatch[1] : '';

          // Participant name
          const nameEl = item.querySelector(
            '.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names, h3'
          );
          const participantName = nameEl?.textContent?.trim() ?? 'Unknown';

          // Message snippet
          const snippetEl = item.querySelector(
            '.msg-conversation-card__message-snippet, .msg-conversation-listitem__message-snippet, p'
          );
          const snippet = snippetEl?.textContent?.trim() ?? '';

          // Timestamp
          const timeEl = item.querySelector('time, .msg-conversation-listitem__time-stamp');
          const timestamp = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? '';

          // Unread indicator
          const unread =
            item.classList.contains('msg-conversation-listitem--unread') ||
            !!item.querySelector('.msg-conversation-listitem__unread-count, .notification-badge');

          if (id) results.push({ id, participantName, snippet, timestamp, unread });
        } catch {
          // skip malformed item
        }
      });

      return results;
    });

    return threads.slice(0, limit);
  } finally {
    await closeBrowserSession(session);
  }
}

export async function scrapeThread(threadId: string, limit = 50): Promise<Message[]> {
  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto(`https://www.linkedin.com/messaging/thread/${threadId}/`, {
      waitUntil: 'domcontentloaded',
    });
    await randomDelay();

    try {
      await session.page.waitForSelector('.msg-s-message-list, .msg-s-message-list-content', { timeout: 15000 });
    } catch {
      await session.page.waitForSelector('[data-view-name="message-list"]', { timeout: 10000 });
    }

    await checkForBlock(session.page);

    const messages = await session.page.evaluate(() => {
      const results: Array<{
        sender: string;
        body: string;
        timestamp: string;
        isMe: boolean;
      }> = [];

      const groups = document.querySelectorAll('.msg-s-message-group, [data-view-name="message-group"]');

      groups.forEach((group) => {
        const isMe =
          group.classList.contains('msg-s-message-group--outgoing') ||
          !!group.querySelector('.msg-s-message-group__meta--outgoing');

        const senderEl = group.querySelector('.msg-s-message-group__name, .msg-s-message-group__meta span');
        const sender = senderEl?.textContent?.trim() ?? (isMe ? 'You' : 'Unknown');

        const msgItems = group.querySelectorAll('.msg-s-event-listitem, [data-view-name="message-list-item"]');
        msgItems.forEach((item) => {
          const bodyEl = item.querySelector('.msg-s-event-listitem__body, .msg-s-message-group__content p');
          const body = bodyEl?.textContent?.trim() ?? '';

          const timeEl = item.querySelector('time');
          const timestamp = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? '';

          if (body) results.push({ sender, body, timestamp, isMe });
        });
      });

      return results;
    });

    return messages.slice(-limit);
  } finally {
    await closeBrowserSession(session);
  }
}

export async function sendMessage(threadId: string, body: string): Promise<void> {
  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto(`https://www.linkedin.com/messaging/thread/${threadId}/`, {
      waitUntil: 'domcontentloaded',
    });
    await randomDelay();

    const composeSelector =
      '.msg-form__contenteditable, [data-placeholder="Write a message…"], [aria-label="Write a message"]';
    await safeClick(session.page, composeSelector);
    await randomDelay(300, 600);

    for (const char of body) {
      await session.page.keyboard.type(char, { delay: Math.floor(Math.random() * 80 + 40) });
    }

    await randomDelay(500, 1000);

    const sendSelector = '.msg-form__send-button, button[type="submit"][aria-label*="Send"]';
    await safeClick(session.page, sendSelector);
    await randomDelay(1000, 2000);
  } finally {
    await closeBrowserSession(session);
  }
}

export async function startNewThread(recipientQuery: string, body: string): Promise<string> {
  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto('https://www.linkedin.com/messaging/compose/', {
      waitUntil: 'domcontentloaded',
    });
    await randomDelay();

    // Type recipient name in search box
    const recipientSelector = 'input[placeholder*="Type a name"], .msg-connections-typeahead__search-field';
    await safeClick(session.page, recipientSelector);
    await randomDelay(300, 600);

    for (const char of recipientQuery) {
      await session.page.keyboard.type(char, { delay: Math.floor(Math.random() * 80 + 40) });
    }

    await randomDelay(1000, 2000);

    // Click first search result
    const resultSelector =
      '.msg-connections-typeahead__result-item, .basic-typeahead__triggered-content li:first-child';
    await safeClick(session.page, resultSelector);
    await randomDelay(500, 1000);

    // Type message
    const composeSelector =
      '.msg-form__contenteditable, [data-placeholder="Write a message…"], [aria-label="Write a message"]';
    await safeClick(session.page, composeSelector);

    for (const char of body) {
      await session.page.keyboard.type(char, { delay: Math.floor(Math.random() * 80 + 40) });
    }

    await randomDelay(500, 1000);

    const sendSelector = '.msg-form__send-button, button[type="submit"]';
    await safeClick(session.page, sendSelector);
    await randomDelay(2000, 3000);

    // Extract thread ID from URL
    const url = session.page.url();
    const match = url.match(/\/messaging\/thread\/([^/]+)/);
    return match ? match[1] : url;
  } finally {
    await closeBrowserSession(session);
  }
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export interface FeedPost {
  urn: string;
  author: string;
  body: string;
  reactions: number;
  comments: number;
  url: string;
  timestamp: string;
}

export async function scrapeFeed(limit: number): Promise<FeedPost[]> {
  const cacheKey = `feed-${limit}`;
  const cached = await getCached<FeedPost[]>(cacheKey, 5 * 60 * 1000);
  if (cached) return cached;

  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await randomDelay();

    try {
      await session.page.waitForSelector(
        '.feed-shared-update-v2, .occludable-update, [data-urn]',
        { timeout: 15000 }
      );
    } catch {
      throw new CliException('Feed did not load in time', ErrorCode.NETWORK_ERROR);
    }

    await checkForBlock(session.page);

    const posts: FeedPost[] = [];
    let scrolls = 0;

    while (posts.length < limit && scrolls < 5) {
      const batch = await session.page.evaluate(() => {
        const results: Array<{
          urn: string;
          author: string;
          body: string;
          reactions: number;
          comments: number;
          url: string;
          timestamp: string;
        }> = [];

        const items = document.querySelectorAll(
          '.feed-shared-update-v2[data-urn], [data-urn][class*="occludable"]'
        );

        items.forEach((item) => {
          const urn = item.getAttribute('data-urn') ?? '';

          const authorEl = item.querySelector(
            '.update-components-actor__name, .feed-shared-actor__name, .update-components-actor__title span[aria-hidden="true"]'
          );
          const author = authorEl?.textContent?.trim() ?? '';

          const bodyEl = item.querySelector(
            '.feed-shared-update-v2__description, .update-components-text, .feed-shared-text'
          );
          const body = bodyEl?.textContent?.trim() ?? '';

          const reactionsEl = item.querySelector(
            '.social-details-social-counts__reactions-count, [aria-label*="reaction"]'
          );
          const reactions = parseInt(reactionsEl?.textContent?.trim().replace(/,/g, '') ?? '0', 10) || 0;

          const commentsEl = item.querySelector(
            '.social-details-social-counts__comments, [aria-label*="comment"]'
          );
          const comments = parseInt(commentsEl?.textContent?.trim().replace(/,/g, '') ?? '0', 10) || 0;

          const linkEl = item.querySelector('a[href*="/feed/update/"]') as HTMLAnchorElement;
          const url = linkEl?.href ?? '';

          const timeEl = item.querySelector('time');
          const timestamp = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? '';

          if (urn || url) results.push({ urn, author, body, reactions, comments, url, timestamp });
        });

        return results;
      });

      for (const post of batch) {
        if (!posts.find((p) => p.urn === post.urn && p.urn !== '')) {
          posts.push(post);
        }
      }

      if (posts.length < limit) {
        await session.page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await randomDelay(1500, 2500);
        scrolls++;
      }
    }

    await setCached(cacheKey, posts.slice(0, limit));
    return posts.slice(0, limit);
  } finally {
    await closeBrowserSession(session);
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchPost {
  urn: string;
  author: string;
  body: string;
  url: string;
}

export async function searchPosts(query: string, limit: number): Promise<SearchPost[]> {
  const cacheKey = `search-posts-${query}-${limit}`;
  const cached = await getCached<SearchPost[]>(cacheKey, 10 * 60 * 1000);
  if (cached) return cached;

  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto(
      `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded' }
    );
    await randomDelay();

    try {
      await session.page.waitForSelector(
        '.search-results__list, .reusable-search__result-container, [data-chameleon-result-urn]',
        { timeout: 15000 }
      );
    } catch {
      throw new CliException('Search results did not load', ErrorCode.NETWORK_ERROR);
    }

    await checkForBlock(session.page);

    const results = await session.page.evaluate(() => {
      const items = document.querySelectorAll(
        '.reusable-search__result-container, .search-results__list > li, [data-chameleon-result-urn]'
      );
      return Array.from(items).map((item) => {
        const urn = item.getAttribute('data-chameleon-result-urn') ?? '';

        const authorEl = item.querySelector(
          '.actor-name, .update-components-actor__name, .app-aware-link span[aria-hidden="true"]'
        );
        const author = authorEl?.textContent?.trim() ?? '';

        const bodyEl = item.querySelector(
          '.feed-shared-update-v2__description, .update-components-text span[dir="ltr"]'
        );
        const body = bodyEl?.textContent?.trim() ?? '';

        const linkEl = item.querySelector('a[href*="/feed/update/"]') as HTMLAnchorElement;
        const url = linkEl?.href ?? '';

        return { urn, author, body, url };
      }).filter((r) => r.author || r.body);
    });

    await setCached(cacheKey, results.slice(0, limit));
    return results.slice(0, limit);
  } finally {
    await closeBrowserSession(session);
  }
}

export interface PersonResult {
  name: string;
  headline: string;
  profileUrl: string;
  connectionDegree: string;
}

export async function searchPeople(query: string, limit: number): Promise<PersonResult[]> {
  const cacheKey = `search-people-${query}-${limit}`;
  const cached = await getCached<PersonResult[]>(cacheKey, 10 * 60 * 1000);
  if (cached) return cached;

  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto(
      `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded' }
    );
    await randomDelay();

    try {
      await session.page.waitForSelector(
        '.reusable-search__result-container, .search-results__list',
        { timeout: 15000 }
      );
    } catch {
      throw new CliException('People search did not load', ErrorCode.NETWORK_ERROR);
    }

    await checkForBlock(session.page);

    const results = await session.page.evaluate(() => {
      const items = document.querySelectorAll('.reusable-search__result-container, .search-results__list > li');
      return Array.from(items).map((item) => {
        const nameEl = item.querySelector(
          '.entity-result__title-text a span[aria-hidden="true"], .actor-name'
        );
        const name = nameEl?.textContent?.trim() ?? '';

        const headlineEl = item.querySelector(
          '.entity-result__primary-subtitle, .subline-level-1'
        );
        const headline = headlineEl?.textContent?.trim() ?? '';

        const linkEl = item.querySelector('a.app-aware-link[href*="/in/"]') as HTMLAnchorElement;
        const profileUrl = linkEl?.href ?? '';

        const degreeEl = item.querySelector(
          '.dist-value, .entity-result__badge-text'
        );
        const connectionDegree = degreeEl?.textContent?.trim() ?? '';

        return { name, headline, profileUrl, connectionDegree };
      }).filter((r) => r.name);
    });

    await setCached(cacheKey, results.slice(0, limit));
    return results.slice(0, limit);
  } finally {
    await closeBrowserSession(session);
  }
}

export interface CompanyResult {
  name: string;
  industry: string;
  followerCount: string;
  profileUrl: string;
}

export async function searchCompanies(query: string, limit: number): Promise<CompanyResult[]> {
  const cacheKey = `search-companies-${query}-${limit}`;
  const cached = await getCached<CompanyResult[]>(cacheKey, 10 * 60 * 1000);
  if (cached) return cached;

  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto(
      `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded' }
    );
    await randomDelay();

    try {
      await session.page.waitForSelector(
        '.reusable-search__result-container, .search-results__list',
        { timeout: 15000 }
      );
    } catch {
      throw new CliException('Company search did not load', ErrorCode.NETWORK_ERROR);
    }

    await checkForBlock(session.page);

    const results = await session.page.evaluate(() => {
      const items = document.querySelectorAll('.reusable-search__result-container, .search-results__list > li');
      return Array.from(items).map((item) => {
        const nameEl = item.querySelector(
          '.entity-result__title-text a span[aria-hidden="true"], .app-aware-link span[aria-hidden="true"]'
        );
        const name = nameEl?.textContent?.trim() ?? '';

        const industryEl = item.querySelector(
          '.entity-result__primary-subtitle'
        );
        const industry = industryEl?.textContent?.trim() ?? '';

        const followerEl = item.querySelector(
          '.entity-result__secondary-subtitle'
        );
        const followerCount = followerEl?.textContent?.trim() ?? '';

        const linkEl = item.querySelector('a.app-aware-link[href*="/company/"]') as HTMLAnchorElement;
        const profileUrl = linkEl?.href ?? '';

        return { name, industry, followerCount, profileUrl };
      }).filter((r) => r.name);
    });

    await setCached(cacheKey, results.slice(0, limit));
    return results.slice(0, limit);
  } finally {
    await closeBrowserSession(session);
  }
}

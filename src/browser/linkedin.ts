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

/**
 * For posts without URLs, click the 3-dot menu on each to extract the URN
 * from the embed/report links that appear in the dropdown.
 */
async function resolvePostUrls(page: import('playwright').Page, posts: FeedPost[]): Promise<void> {
  const items = await page.$$('div[role="listitem"]');

  for (const post of posts) {
    if (post.url) continue;

    // Find the matching listitem by author name
    for (const item of items) {
      const menuBtn = await item.$(`button[aria-label="Open control menu for post by ${post.author}"]`);
      if (!menuBtn) continue;

      // Check if we already resolved this one (in case of multiple posts by same author)
      const alreadyHasUrn = !post.urn.startsWith('feed-item-');
      if (alreadyHasUrn) {
        post.url = `https://www.linkedin.com/feed/update/${post.urn}/`;
        break;
      }

      try {
        // Click the 3-dot menu via JS to avoid overlay issues
        await menuBtn.evaluate((b: Element) => (b as HTMLElement).click());
        await randomDelay(800, 1200);

        // Extract URN from embed/report links in the dropdown
        const urn = await page.evaluate(() => {
          const menuLinks = Array.from(document.querySelectorAll('[role="menu"] a[href], [role="menuitem"] a[href], a[role="menuitem"]'));
          for (const link of menuLinks) {
            const href = (link as HTMLAnchorElement).href ?? '';
            const m = href.match(/urn(?:%3A|:)li(?:%3A|:)(\w+)(?:%3A|:)(\d+)/);
            if (m) {
              return `urn:li:${m[1]}:${m[2]}`;
            }
          }
          return '';
        });

        // Close the menu
        await page.keyboard.press('Escape');
        await randomDelay(300, 500);

        if (urn) {
          post.urn = urn;
          post.url = `https://www.linkedin.com/feed/update/${urn}/`;
        }
      } catch {
        // If menu interaction fails, skip this post
        try { await page.keyboard.press('Escape'); } catch { /* ignore */ }
      }
      break;
    }
  }
}

export async function scrapeFeed(limit: number): Promise<FeedPost[]> {
  const cacheKey = `feed-${limit}`;
  const cached = await getCached<FeedPost[]>(cacheKey, 5 * 60 * 1000);
  if (cached) return cached;

  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'load' });
    await randomDelay(3000, 4000); // extra wait for React to render feed posts
    await checkForBlock(session.page);

    const posts: FeedPost[] = [];
    let scrolls = 0;

    while (posts.length < limit && scrolls < 6) {
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

        // LinkedIn 2025+: feed posts are div[role="listitem"] elements
        const items = Array.from(document.querySelectorAll('div[role="listitem"]'));

        items.forEach((item) => {
          // Extract author from the control menu button aria-label
          // Pattern: "Open control menu for post by <Author Name>"
          const menuBtn = item.querySelector('button[aria-label^="Open control menu for post by"]');
          const author = menuBtn?.getAttribute('aria-label')?.replace('Open control menu for post by', '').trim() ?? '';

          // Extract post body — find the longest <p> or <span> that looks like post content
          // Post body text is in <p> elements; skip short ones (names, labels) and comment text
          const allTextEls = Array.from(item.querySelectorAll('p, span'));
          let body = '';
          let bodyLen = 0;
          for (const el of allTextEls) {
            const text = el.textContent?.trim() ?? '';
            // Skip very short text, reaction/comment counts, and elements inside comment sections
            if (text.length <= 30) continue;
            if (/^\d+\s*(reaction|comment|repost)/i.test(text)) continue;
            // Skip if this element is inside a nested listitem (comment)
            if (el.closest('div[role="listitem"]') !== item) continue;
            if (text.length > bodyLen) {
              body = text;
              bodyLen = text.length;
            }
          }

          // Extract reactions count from link text like "7 reactions7" or "123 reactions"
          const allLinks = Array.from(item.querySelectorAll('a'));
          let reactions = 0;
          let comments = 0;
          for (const link of allLinks) {
            const text = link.textContent?.trim() ?? '';
            const reactMatch = text.match(/^(\d[\d,]*)\s*reaction/i);
            if (reactMatch) {
              reactions = parseInt(reactMatch[1].replace(/,/g, ''), 10) || 0;
            }
            const commentMatch = text.match(/^(\d[\d,]*)\s*comment/i);
            if (commentMatch) {
              comments = parseInt(commentMatch[1].replace(/,/g, ''), 10) || 0;
            }
          }
          // Also check <p> elements for comment counts (e.g. "738 comments738 comments")
          if (comments === 0) {
            const allP = Array.from(item.querySelectorAll('p'));
            for (const p of allP) {
              const text = p.textContent?.trim() ?? '';
              const m = text.match(/(\d[\d,]*)\s*comment/i);
              if (m) {
                comments = parseInt(m[1].replace(/,/g, ''), 10) || 0;
                break;
              }
            }
          }

          // Extract URN and URL
          // Strategy 1: direct link to feed/update/urn
          const postLink = item.querySelector('a[href*="feed/update/urn"]') as HTMLAnchorElement | null;
          let url = postLink?.href ?? '';
          let urn = '';

          if (url) {
            const urnMatch = url.match(/(urn:li:\w+:\d+)/);
            urn = urnMatch?.[1] ?? '';
          }

          // Strategy 2: extract activity URN from componentkey attributes
          if (!urn) {
            const allEls = Array.from(item.querySelectorAll('[componentkey]'));
            for (const el of allEls) {
              const key = el.getAttribute('componentkey') ?? '';
              const m = key.match(/(urn:li:activity:\d+)/);
              if (m) {
                urn = m[1];
                break;
              }
            }
          }

          // Strategy 3: extract from hide button aria-label or other data attributes
          if (!urn) {
            const allEls = Array.from(item.querySelectorAll('*'));
            for (const el of allEls) {
              for (const attr of Array.from(el.attributes)) {
                const m = attr.value.match(/(urn:li:(?:activity|ugcPost|share):\d+)/);
                if (m) {
                  urn = m[1];
                  break;
                }
              }
              if (urn) break;
            }
          }

          // Construct URL from URN if we don't have one yet
          if (!url && urn) {
            url = `https://www.linkedin.com/feed/update/${urn}/`;
          }

          // Fallback ID if we still have no URN
          if (!urn) {
            urn = `feed-item-${Math.random().toString(36).slice(2, 10)}`;
          }

          // Extract timestamp — look for text like "2w", "3d", "1h" near the author area
          let timestamp = '';
          const profileLinks = Array.from(item.querySelectorAll('a[href*="/in/"], a[href*="/company/"]'));
          for (const link of profileLinks) {
            const text = link.textContent?.trim() ?? '';
            const timeMatch = text.match(/(\d+[smhdw])\s*[•·]?\s*$/);
            if (timeMatch) {
              timestamp = timeMatch[1];
              break;
            }
          }

          if (author || body) {
            results.push({ urn, author, body, reactions, comments, url, timestamp });
          }
        });

        return results;
      });

      for (const post of batch) {
        // Dedup by URN if real, otherwise by author+body prefix
        const isDupe = posts.some((p) =>
          (post.urn && !post.urn.startsWith('feed-item-') && p.urn === post.urn) ||
          (p.author === post.author && p.body.slice(0, 100) === post.body.slice(0, 100))
        );
        if (!isDupe) {
          posts.push(post);
        }
      }

      if (posts.length < limit) {
        await session.page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await randomDelay(1500, 2500);
        scrolls++;
      }
    }

    if (posts.length === 0) {
      throw new CliException('No feed posts found — LinkedIn DOM may have changed', ErrorCode.NETWORK_ERROR);
    }

    // For posts missing URLs, click 3-dot menu to extract URN from embed/report links
    const postsToResolve = posts.slice(0, limit).filter((p) => !p.url);
    if (postsToResolve.length > 0) {
      await resolvePostUrls(session.page, posts.slice(0, limit));
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

    // Wait for search results to render — use role="listitem" (LinkedIn 2025+ DOM)
    await randomDelay(3000, 4000);
    await checkForBlock(session.page);

    // Check if results loaded
    const hasResults = await session.page.evaluate(() =>
      document.querySelectorAll('div[role="listitem"]').length > 0
    );
    if (!hasResults) {
      // Try waiting a bit more
      await randomDelay(3000, 4000);
    }

    const results = await session.page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div[role="listitem"]'));

      return items.map((item) => {
        // Author from control menu button
        const menuBtn = item.querySelector('button[aria-label^="Open control menu for post by"]');
        const author = menuBtn?.getAttribute('aria-label')?.replace('Open control menu for post by', '').trim() ?? '';

        // Body — longest text element
        const allTextEls = Array.from(item.querySelectorAll('p, span'));
        let body = '';
        let bodyLen = 0;
        for (const el of allTextEls) {
          const text = el.textContent?.trim() ?? '';
          if (text.length <= 30) continue;
          if (/^\d+\s*(reaction|comment|repost)/i.test(text)) continue;
          if (el.closest('div[role="listitem"]') !== item) continue;
          if (text.length > bodyLen) {
            body = text;
            bodyLen = text.length;
          }
        }

        // Extract URN and URL
        const postLink = item.querySelector('a[href*="feed/update/urn"]') as HTMLAnchorElement | null;
        let url = postLink?.href ?? '';
        let urn = '';

        if (url) {
          const m = url.match(/(urn:li:\w+:\d+)/);
          urn = m?.[1] ?? '';
        }

        // Fallback: extract URN from componentkey or other attributes
        if (!urn) {
          const allEls = Array.from(item.querySelectorAll('*'));
          for (const el of allEls) {
            for (const attr of Array.from(el.attributes)) {
              const m = attr.value.match(/(urn:li:(?:activity|ugcPost|share):\d+)/);
              if (m) {
                urn = m[1];
                break;
              }
            }
            if (urn) break;
          }
        }

        // Construct URL from URN if needed
        if (!url && urn) {
          url = `https://www.linkedin.com/feed/update/${urn}/`;
        }

        return { urn, author, body, url };
      }).filter((r) => r.author || r.body);
    });

    // Resolve URLs for posts that don't have them via 3-dot menu
    const searchResults = results.slice(0, limit);
    const needsUrl = searchResults.filter((r) => !r.url);
    if (needsUrl.length > 0) {
      const items = await session.page.$$('div[role="listitem"]');
      for (const result of needsUrl) {
        for (const item of items) {
          const menuBtn = await item.$(`button[aria-label="Open control menu for post by ${result.author}"]`);
          if (!menuBtn) continue;
          try {
            await menuBtn.evaluate((b: Element) => (b as HTMLElement).click());
            await randomDelay(800, 1200);
            const urn = await session.page.evaluate(() => {
              const menuLinks = Array.from(document.querySelectorAll('[role="menu"] a[href], [role="menuitem"] a[href], a[role="menuitem"]'));
              for (const link of menuLinks) {
                const href = (link as HTMLAnchorElement).href ?? '';
                const m = href.match(/urn(?:%3A|:)li(?:%3A|:)(\w+)(?:%3A|:)(\d+)/);
                if (m) return `urn:li:${m[1]}:${m[2]}`;
              }
              return '';
            });
            await session.page.keyboard.press('Escape');
            await randomDelay(300, 500);
            if (urn) {
              result.urn = urn;
              result.url = `https://www.linkedin.com/feed/update/${urn}/`;
            }
          } catch {
            try { await session.page.keyboard.press('Escape'); } catch { /* ignore */ }
          }
          break;
        }
      }
    }

    await setCached(cacheKey, searchResults);
    return searchResults;
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

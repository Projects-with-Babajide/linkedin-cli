import { createBrowserSession, closeBrowserSession } from './session';
import { randomDelay, safeClick, checkForBlock, ensureLoggedIn } from './helpers';
import { CliException, ErrorCode } from '../utils/errors';
import { getCached, setCached } from '../storage/cache';
import { debug } from '../utils/logger';

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
    await session.page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'load' });
    await randomDelay(3000, 4000);

    // Wait for conversation list
    try {
      await session.page.waitForSelector('li.msg-conversation-listitem', { timeout: 15000 });
    } catch {
      await checkForBlock(session.page);
      throw new CliException('Message list did not load', ErrorCode.NETWORK_ERROR);
    }

    await checkForBlock(session.page);

    // LinkedIn no longer renders an anchor with an href on conversation items
    // (the "link" is a <div tabindex="0">). The only way to get a thread ID is
    // to click and read the resulting URL. We harden this by:
    //   * Re-querying ElementHandles fresh every iteration (never reuse stale).
    //   * Deduping by a participant+snippet+timestamp signature so we don't
    //     re-click items we already resolved.
    //   * Waiting for the URL to actually change to a new /messaging/thread/<id>/
    //     before reading it (fixes the cascade where a no-op click left
    //     page.url() pointing at the previous thread).
    //   * Special-casing the active item — its URL is already in the address
    //     bar after LinkedIn's auto-nav on page load, so we don't need to click.
    const map = new Map<string, MessageThread>();
    const processed = new Set<string>();
    let staleScrolls = 0;

    type ItemSig = {
      idx: number;
      participantName: string;
      snippet: string;
      timestamp: string;
      unread: boolean;
      isActive: boolean;
    };

    const readItemSigs = (): Promise<ItemSig[]> =>
      session.page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('li.msg-conversation-listitem'));
        return items.map((el, idx) => {
          const nameEl = el.querySelector(
            '.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names, h3'
          );
          const participantName = nameEl?.textContent?.trim() ?? 'Unknown';

          const snippetEl = el.querySelector(
            '.msg-conversation-card__message-snippet, .msg-conversation-listitem__message-snippet, p'
          );
          const snippet = snippetEl?.textContent?.trim() ?? '';

          const timeEl = el.querySelector('time, .msg-conversation-listitem__time-stamp');
          const timestamp = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? '';

          const unread =
            el.classList.contains('msg-conversation-listitem--unread') ||
            !!el.querySelector('.msg-conversation-listitem__unread-count, .notification-badge');

          const linkInner = el.querySelector('.msg-conversation-listitem__link');
          const isActive =
            !!linkInner?.classList.contains('msg-conversations-container__convo-item-link--active') ||
            !!el.querySelector('.msg-conversations-container__convo-item-link--active');

          return { idx, participantName, snippet, timestamp, unread, isActive };
        });
      });

    const sigKey = (s: ItemSig): string =>
      `${s.participantName}|${s.snippet.slice(0, 60)}|${s.timestamp}`;

    while (map.size < limit && staleScrolls < 2) {
      const sigs = await readItemSigs();
      debug(`messages: scanning ${sigs.length} rendered items, map.size=${map.size}`);
      const sizeBefore = map.size;

      for (const s of sigs) {
        if (map.size >= limit) break;
        const key = sigKey(s);
        if (processed.has(key)) continue;

        // Active item: URL is already a thread URL after LinkedIn's auto-nav.
        // No click needed — just read it.
        if (s.isActive) {
          const url = session.page.url();
          const m = url.match(/\/messaging\/thread\/([^/?]+)/);
          if (m) {
            const id = m[1];
            processed.add(key);
            if (!map.has(id)) {
              map.set(id, {
                id,
                participantName: s.participantName,
                snippet: s.snippet,
                timestamp: s.timestamp,
                unread: s.unread,
              });
            }
            continue;
          }
        }

        // Click the item: re-query handles right before clicking so we never
        // hold a stale ElementHandle across a click.
        const before = session.page.url();
        const items = await session.page.$$('li.msg-conversation-listitem');
        if (s.idx >= items.length) {
          // List shrank between read and click — skip; we'll re-scan next loop.
          continue;
        }

        try {
          await items[s.idx].evaluate((el: Element) => {
            const link = el.querySelector('.msg-conversation-listitem__link') as HTMLElement | null;
            (link ?? (el as HTMLElement)).click();
          });
        } catch {
          processed.add(key);
          continue;
        }

        // Wait for the URL to settle on a NEW thread URL. If it doesn't change
        // within 4s, the click no-op'd or routed elsewhere — skip.
        try {
          await session.page.waitForFunction(
            (prev: string) => {
              const cur = location.href;
              return cur !== prev && /\/messaging\/thread\/[^/?]+/.test(cur);
            },
            before,
            { timeout: 4000 }
          );
        } catch {
          debug(`messages: click on idx=${s.idx} (${s.participantName}) did not change URL — skipping`);
          processed.add(key);
          continue;
        }

        const url = session.page.url();
        const m = url.match(/\/messaging\/thread\/([^/?]+)/);
        const id = m ? m[1] : '';
        processed.add(key);

        if (id && !map.has(id)) {
          map.set(id, {
            id,
            participantName: s.participantName,
            snippet: s.snippet,
            timestamp: s.timestamp,
            unread: s.unread,
          });
        }

        // Small pacing delay between clicks
        await randomDelay(150, 350);
      }

      if (map.size >= limit) break;

      // Scroll the inner conversation list container to lazy-load more.
      await session.page.evaluate(() => {
        const candidates = [
          '.msg-conversations-container__conversations-list',
          '.msg-conversations-container__list-wrapper',
          '.scaffold-finite-scroll__content',
        ];
        let target: HTMLElement | null = null;
        for (const sel of candidates) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el && el.scrollHeight > el.clientHeight) {
            target = el;
            break;
          }
        }
        if (!target) {
          const item = document.querySelector('li.msg-conversation-listitem') as HTMLElement | null;
          let cursor: HTMLElement | null = item?.parentElement ?? null;
          while (cursor) {
            const style = getComputedStyle(cursor);
            const scrollable =
              cursor.scrollHeight > cursor.clientHeight &&
              (style.overflowY === 'auto' || style.overflowY === 'scroll');
            if (scrollable) { target = cursor; break; }
            cursor = cursor.parentElement;
          }
        }
        if (target) target.scrollTop = target.scrollHeight;
      });
      await randomDelay(800, 1200);

      if (map.size === sizeBefore) staleScrolls++;
      else staleScrolls = 0;
    }

    return Array.from(map.values()).slice(0, limit);
  } finally {
    await closeBrowserSession(session);
  }
}

export async function scrapeThread(threadId: string, limit = 50): Promise<Message[]> {
  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto(`https://www.linkedin.com/messaging/thread/${threadId}/`, {
      waitUntil: 'load',
    });
    await randomDelay(2000, 3000);

    // Wait for messages to render
    try {
      await session.page.waitForSelector(
        '.msg-s-message-list, .msg-s-message-list-content, [class*="msg-s-event"]',
        { timeout: 15000 }
      );
    } catch {
      await checkForBlock(session.page);
    }

    const messages = await session.page.evaluate(() => {
      const results: Array<{
        sender: string;
        body: string;
        timestamp: string;
        isMe: boolean;
      }> = [];

      // Strategy 1: msg-s-message-group (classic LinkedIn messaging DOM)
      const groups = document.querySelectorAll('.msg-s-message-group');
      if (groups.length > 0) {
        groups.forEach((group) => {
          const isMe =
            group.classList.contains('msg-s-message-group--outgoing') ||
            !!group.querySelector('[class*="outgoing"]');

          const senderEl = group.querySelector('.msg-s-message-group__name span');
          const sender = senderEl?.textContent?.trim() ?? (isMe ? 'You' : 'Unknown');

          const msgItems = group.querySelectorAll('.msg-s-event-listitem');
          msgItems.forEach((item) => {
            const bodyEl = item.querySelector('.msg-s-event-listitem__body');
            const body = bodyEl?.textContent?.trim() ?? '';

            const timeEl = item.querySelector('time');
            const timestamp = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? '';

            if (body) results.push({ sender, body, timestamp, isMe });
          });
        });
        return results;
      }

      // Strategy 2: parse the accessible structure
      // Messages have a pattern: "[Name] sent the following message(s) at [time]"
      // followed by the actual message content
      const allEvents = document.querySelectorAll('[class*="msg-s-event"], li[class*="msg-s"]');
      if (allEvents.length > 0) {
        allEvents.forEach((event) => {
          const srText = event.querySelector('.visually-hidden, [class*="visually-hidden"]');
          const srContent = srText?.textContent?.trim() ?? '';

          // Parse "Name sent the following message(s) at Time"
          const headerMatch = srContent.match(/^(.+?)\s+sent the following message/);
          if (headerMatch) {
            const sender = headerMatch[1];
            const timeMatch = srContent.match(/at\s+(.+)$/);
            const timestamp = timeMatch?.[1] ?? '';

            // Find message body — the main text content excluding UI elements
            const bodyEl = event.querySelector('.msg-s-event-listitem__body, p[class*="message"]');
            if (bodyEl) {
              const body = bodyEl.textContent?.trim() ?? '';
              if (body) {
                const isMe = sender === 'You' || sender.includes('Babajide');
                results.push({ sender, body, timestamp, isMe });
              }
            }
          }
        });
        return results;
      }

      // Strategy 3: broad fallback — look for message containers with profile links
      // Parse blocks that have "View [Name]'s profile" and extract subsequent text
      const messageBlocks = document.querySelectorAll('[class*="message-event"], [class*="msg-s-message-list"] > *');
      let currentSender = 'Unknown';
      let currentTime = '';
      let currentIsMe = false;

      messageBlocks.forEach((block) => {
        // Check for sender header
        const profileLink = block.querySelector('a[class*="profile"]');
        if (profileLink) {
          const nameEl = block.querySelector('h4, h3, [class*="name"]');
          currentSender = nameEl?.textContent?.trim() ?? 'Unknown';
          const timeEl = block.querySelector('time');
          currentTime = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? '';
          currentIsMe = !!block.querySelector('[class*="outgoing"]');
        }

        // Check for message body
        const bodyEl = block.querySelector('p[class*="body"], [class*="event-listitem__body"]');
        const body = bodyEl?.textContent?.trim() ?? '';
        if (body && body.length > 0) {
          results.push({ sender: currentSender, body, timestamp: currentTime, isMe: currentIsMe });
        }
      });

      return results;
    });

    // Deduplicate (LinkedIn sometimes renders messages multiple times)
    const seen = new Set<string>();
    const deduped = messages.filter((m) => {
      const key = `${m.sender}:${m.body}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduped.slice(-limit);
  } finally {
    await closeBrowserSession(session);
  }
}

export async function sendMessage(threadId: string, body: string): Promise<void> {
  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto(`https://www.linkedin.com/messaging/thread/${threadId}/`, {
      waitUntil: 'load',
    });
    await randomDelay(2000, 3000);

    const composeSelector =
      '.msg-form__contenteditable, [aria-label="Write a message…"], [role="textbox"]';
    await safeClick(session.page, composeSelector);
    await randomDelay(300, 600);

    for (const char of body) {
      await session.page.keyboard.type(char, { delay: Math.floor(Math.random() * 80 + 40) });
    }

    await randomDelay(500, 1000);

    // LinkedIn messaging uses Enter to send (shown as "Press Enter to Send")
    // Try clicking a send button first, fall back to Enter
    try {
      const sendBtn = await session.page.$('.msg-form__send-button, button[type="submit"][aria-label*="Send"]');
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await session.page.keyboard.press('Enter');
      }
    } catch {
      await session.page.keyboard.press('Enter');
    }

    await randomDelay(1000, 2000);
  } finally {
    await closeBrowserSession(session);
  }
}

export async function startNewThread(recipientQuery: string, body: string): Promise<string> {
  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);

    // If recipientQuery looks like a LinkedIn profile URL, navigate there and click Message
    const isProfileUrl = recipientQuery.includes('linkedin.com/in/') || recipientQuery.startsWith('/in/');
    if (isProfileUrl) {
      const profileUrl = recipientQuery.startsWith('http') ? recipientQuery : `https://www.linkedin.com${recipientQuery}`;
      await session.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
      await randomDelay(3000, 4000);

      // Click the Message button on the profile via JS to bypass any overlays
      const clicked = await session.page.evaluate(() => {
        // Try anchor with messaging/compose href
        const msgLink = document.querySelector('a[href*="/messaging/compose"]') as HTMLElement | null;
        if (msgLink) { msgLink.click(); return 'link'; }
        // Try button with "Message" text
        const buttons = Array.from(document.querySelectorAll('button'));
        const msgBtn = buttons.find(b => b.textContent?.trim() === 'Message');
        if (msgBtn) { msgBtn.click(); return 'button'; }
        return null;
      });
      if (!clicked) {
        throw new CliException('Could not find Message button on profile', ErrorCode.SELECTOR_ERROR);
      }
      await randomDelay(2000, 3000);
    } else {
      // Fall back to compose page with typeahead
      await session.page.goto('https://www.linkedin.com/messaging/compose/', {
        waitUntil: 'domcontentloaded',
      });
      await randomDelay(2000, 3000);

      const recipientSelector = 'input[placeholder*="name"], input[placeholder*="Search"], .msg-connections-typeahead__search-field, [role="combobox"]';
      await safeClick(session.page, recipientSelector);
      await randomDelay(300, 600);

      for (const char of recipientQuery) {
        await session.page.keyboard.type(char, { delay: Math.floor(Math.random() * 80 + 40) });
      }
      await randomDelay(1500, 2500);

      // Click first result in the typeahead dropdown
      const resultSelector = 'li[class*="typeahead"], [role="option"], [role="listbox"] li, ul[class*="typeahead"] li';
      await safeClick(session.page, resultSelector);
      await randomDelay(500, 1000);
    }

    // Type message in compose box
    const composeSelector =
      '.msg-form__contenteditable, [role="textbox"], [contenteditable="true"], [aria-label*="message" i], [aria-label*="Message" i]';
    await safeClick(session.page, composeSelector);
    await randomDelay(500, 800);

    // Split on newlines and use Shift+Enter for line breaks
    // (LinkedIn uses plain Enter to send, so newlines must be Shift+Enter)
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const char of lines[i]) {
        await session.page.keyboard.type(char, { delay: Math.floor(Math.random() * 60 + 30) });
      }
      if (i < lines.length - 1) {
        await session.page.keyboard.press('Shift+Enter');
        await randomDelay(50, 100);
      }
    }

    await randomDelay(800, 1200);

    // Send — try button first, fall back to Enter
    const sendBtn = await session.page.$('.msg-form__send-button, button[type="submit"][aria-label*="Send" i]');
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await session.page.keyboard.press('Enter');
    }
    await randomDelay(2000, 3000);

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

    // Wait for profile links to appear
    try {
      await session.page.waitForSelector('a[href*="/in/"]', { timeout: 15000 });
    } catch {
      throw new CliException('People search did not load', ErrorCode.NETWORK_ERROR);
    }
    await randomDelay(1500, 2000);

    await checkForBlock(session.page);

    const results = await session.page.evaluate(() => {
      // LinkedIn 2025: profile card links have multiline innerText with name, degree, headline, location
      // Pattern: "Name \n • Degree\n\nHeadline\n\nLocation\n\nAction"
      const profileLinks = Array.from(
        document.querySelectorAll('a[href*="linkedin.com/in/"], a[href^="/in/"]')
      ) as HTMLAnchorElement[];

      const seen = new Set<string>();
      const items: Array<{ name: string; headline: string; profileUrl: string; connectionDegree: string }> = [];

      for (const link of profileLinks) {
        const href = link.href;
        if (seen.has(href)) continue;

        const raw = (link as HTMLElement).innerText ?? '';
        // Card links have multi-line content; skip short ones (nav, name-only duplicates)
        if (!raw.includes('\n')) continue;

        seen.add(href);

        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) continue;

        // First line is the name (may include degree suffix like " • 2nd")
        const firstLine = lines[0];
        const degreeMatch = firstLine.match(/[•·]\s*(1st|2nd|3rd\+?)$/);
        const connectionDegree = degreeMatch?.[1] ?? '';
        const name = firstLine.replace(/\s*[•·]\s*(1st|2nd|3rd\+?)\s*$/, '').trim();

        // Second meaningful line is the headline (skip degree-only lines)
        const headline = lines.find(l => l !== name && !/^[•·]?\s*(1st|2nd|3rd\+?)$/.test(l)) ?? '';

        if (name) {
          items.push({ name, headline, profileUrl: href, connectionDegree });
        }
      }

      return items;
    });

    await setCached(cacheKey, results.slice(0, limit));
    return results.slice(0, limit);
  } finally {
    await closeBrowserSession(session);
  }
}

// ─── Connections ─────────────────────────────────────────────────────────────

export interface Connection {
  name: string;
  headline: string;
  profileUrl: string;
  connectedAt: string;
}

export async function scrapeRecentConnections(limit: number): Promise<Connection[]> {
  const cacheKey = `recent-connections-${limit}`;
  const cached = await getCached<Connection[]>(cacheKey, 30 * 60 * 1000);
  if (cached) return cached;

  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto(
      'https://www.linkedin.com/mynetwork/invite-connect/connections/',
      { waitUntil: 'load' }
    );
    await randomDelay(3000, 4000);

    // Wait for profile links to appear (LinkedIn uses hashed CSS classes, so match on href)
    try {
      await session.page.waitForSelector('a[href*="/in/"]', { timeout: 15000 });
    } catch {
      await checkForBlock(session.page);
      throw new CliException('Connections page did not load', ErrorCode.NETWORK_ERROR);
    }

    await checkForBlock(session.page);

    // Click "Load more" or scroll to get enough connections
    let previousCount = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const currentCount = await session.page.evaluate(
        () => document.querySelectorAll('a[href*="/in/"]').length
      );
      if (currentCount >= limit * 2 || currentCount === previousCount) break;
      previousCount = currentCount;

      // Try clicking a "Load more" button first, then scroll
      const clicked = await session.page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.textContent?.trim().toLowerCase().includes('load more')
        );
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (!clicked) {
        await session.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      }
      await randomDelay(1500, 2500);
    }

    // Parse connections from the page body text
    // LinkedIn renders: "Name\nHeadline\nConnected on <date>\nMessage" per connection
    const connections = await session.page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      const text = (main as HTMLElement).innerText ?? '';
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

      // Collect all profile links with text content (name + headline)
      const profileLinks = Array.from(
        document.querySelectorAll('a[href*="/in/"]')
      ) as HTMLAnchorElement[];

      const seen = new Set<string>();
      const results: Array<{ name: string; headline: string; profileUrl: string; connectedAt: string }> = [];

      for (const link of profileLinks) {
        const href = link.href;
        if (seen.has(href)) continue;

        const raw = (link as HTMLElement).innerText ?? '';
        // Profile card links have "Name\nHeadline"; skip empty or single-word links (avatar links)
        if (!raw.includes('\n')) continue;
        seen.add(href);

        const parts = raw.split('\n').map((l) => l.trim()).filter(Boolean);
        if (parts.length < 2) continue;

        const name = parts[0];
        const headline = parts.slice(1).join(' ');

        // Find "Connected on ..." in the page text near this person's name
        const connIdx = lines.findIndex(
          (l) => l.startsWith('Connected on') &&
            lines.indexOf(name) !== -1 &&
            lines.indexOf(name) < lines.indexOf(l)
        );
        const connectedAt = connIdx !== -1
          ? lines[connIdx].replace('Connected on ', '')
          : '';

        results.push({ name, headline, profileUrl: href, connectedAt });
      }

      return results;
    });

    await setCached(cacheKey, connections.slice(0, limit));
    return connections.slice(0, limit);
  } finally {
    await closeBrowserSession(session);
  }
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  actor: string;
  text: string;
  timestamp: string;
  url: string;
  unread: boolean;
}

export async function scrapeNotifications(limit: number, unreadOnly: boolean): Promise<Notification[]> {
  const session = await createBrowserSession();
  try {
    await ensureLoggedIn(session.page);
    await session.page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'load' });
    await randomDelay(3000, 4000);
    await checkForBlock(session.page);

    try {
      await session.page.waitForSelector(
        'section.nt-card-list, [data-finite-scroll-hotkey-item], .notification-item, [class*="nt-card"]',
        { timeout: 15000 }
      );
    } catch {
      await checkForBlock(session.page);
    }

    const results = await session.page.evaluate((unreadOnly: boolean) => {
      const notifications: Array<{
        id: string;
        type: string;
        actor: string;
        text: string;
        timestamp: string;
        url: string;
        unread: boolean;
      }> = [];

      // LinkedIn 2025+ notifications DOM: cards inside section.nt-card-list
      const cards = Array.from(document.querySelectorAll(
        '[data-finite-scroll-hotkey-item], .nt-card-list__item, section.nt-card-list > *, [class*="notification-card"], [class*="nt-card"]'
      ));

      // Fallback to any list items in the notifications feed
      const items = cards.length > 0 ? cards : Array.from(document.querySelectorAll('li, article')).filter(el => {
        const text = el.textContent ?? '';
        return text.length > 10 && el.closest('[role="feed"], [role="list"], main');
      });

      items.forEach((item, idx) => {
        // Unread detection: look for unread indicator classes or aria
        const unread =
          item.classList.contains('nt-card--unread') ||
          item.classList.contains('unread') ||
          !!item.querySelector('[class*="unread"], .notification-badge') ||
          item.getAttribute('data-is-read') === 'false';

        if (unreadOnly && !unread) return;

        // Actor name — usually first bold/strong text or a profile link
        const actorEl = item.querySelector('a[href*="/in/"] span[aria-hidden="true"], a[href*="/company/"] span[aria-hidden="true"], strong, b, .nt-card__actor-name, [class*="actor-name"]');
        const actor = actorEl?.textContent?.trim() ?? '';

        // Full notification text — prefer visible text, exclude sr-only / visually-hidden elements
        // Clone the item and strip hidden elements before reading text
        const clone = item.cloneNode(true) as Element;
        clone.querySelectorAll('.visually-hidden, .sr-only, [aria-hidden="true"], time, [class*="visually-hidden"]').forEach(el => el.remove());
        let text = clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        // Trim to a reasonable length
        text = text.slice(0, 300);

        // Timestamp — look for <time> or relative time text
        const timeEl = item.querySelector('time, [class*="time"], [class*="timestamp"]');
        const timestamp = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? '';

        // URL — first link in the card
        const linkEl = item.querySelector('a[href]') as HTMLAnchorElement | null;
        const url = linkEl?.href ?? '';

        // Type inference from text/icons
        let type = 'other';
        const lowerText = text.toLowerCase();
        if (lowerText.includes('like') || lowerText.includes('reaction') || lowerText.includes('react')) type = 'reaction';
        else if (lowerText.includes('comment')) type = 'comment';
        else if (lowerText.includes('connect') || lowerText.includes('invitation') || lowerText.includes('accepted')) type = 'connection';
        else if (lowerText.includes('mention')) type = 'mention';
        else if (lowerText.includes('repost') || lowerText.includes('shared your')) type = 'repost';
        else if (lowerText.includes('follow')) type = 'follow';
        else if (lowerText.includes('job') || lowerText.includes('hired') || lowerText.includes('work anniversar') || lowerText.includes('new role')) type = 'career';
        else if (lowerText.includes('birthday') || lowerText.includes('anniversar')) type = 'milestone';
        else if (lowerText.includes('view') || lowerText.includes('profile')) type = 'profile_view';

        if (text.length > 5) {
          notifications.push({
            id: `notif-${idx}`,
            type,
            actor,
            text,
            timestamp,
            url,
            unread,
          });
        }
      });

      return notifications;
    }, unreadOnly);

    // Deduplicate by text+actor
    const seen = new Set<string>();
    const deduped = results.filter((n) => {
      const key = `${n.actor}:${n.text.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduped.slice(0, limit);
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

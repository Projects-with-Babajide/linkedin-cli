import { createBrowserSession, closeBrowserSession } from './session';
import { randomDelay, safeClick, checkForBlock, ensureLoggedIn } from './helpers';

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

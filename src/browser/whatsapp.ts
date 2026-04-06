import { Page } from 'playwright';
import { createWhatsAppSession, closeWhatsAppSession } from './whatsapp-session';

const WA_URL = 'https://web.whatsapp.com/';
const LOAD_TIMEOUT = 60_000;
const QR_TIMEOUT = 120_000;
const CHAT_LIST_SELECTOR = '[aria-label="Chat list"]';

export interface WhatsAppChat {
  name: string;
  lastMessage: string;
  timestamp: string;
  unread: boolean;
  unreadCount: number;
}

export interface WhatsAppMessage {
  sender: string;
  body: string;
  timestamp: string;
  isMe: boolean;
}

/**
 * Navigates to WhatsApp Web and waits for the user to scan the QR code if not already logged in.
 * On subsequent runs the persistent profile restores the session automatically.
 */
async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto(WA_URL, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });

  const qrVisible = await page
    .isVisible('canvas[aria-label="Scan me!"], [data-ref]', { timeout: 5_000 })
    .catch(() => false);

  if (qrVisible) {
    process.stderr.write('[whatsapp] QR code detected — please scan with your phone to log in...\n');
    await page.waitForSelector(CHAT_LIST_SELECTOR, { timeout: QR_TIMEOUT });
    process.stderr.write('[whatsapp] Logged in successfully.\n');
  } else {
    await page.waitForSelector(CHAT_LIST_SELECTOR, { timeout: LOAD_TIMEOUT });
  }
}

/**
 * Opens a chat by name using the WhatsApp Web search box.
 * Clicks the first matching result.
 */
async function openChat(page: Page, chatName: string): Promise<void> {
  const searchInput = await page.waitForSelector(
    '[aria-label="Search input textbox"]',
    { timeout: 10_000 },
  );
  await searchInput.click();
  await page.waitForTimeout(500);
  await page.keyboard.type(chatName);
  await page.waitForTimeout(1_500);

  // Search results appear in a separate grid
  await page.waitForSelector('[aria-label="Search results."]', { timeout: 5_000 });

  // Click the first chat row (skip section header rows that have no spans with title)
  const rows = await page.$$('[aria-label="Search results."] [role="row"]');
  let clicked = false;
  for (const row of rows) {
    const hasTitle = await row.$('span[title]');
    if (hasTitle) {
      await row.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    throw new Error(`Chat not found: ${chatName}`);
  }

  // Wait for the compose box to confirm the right conversation loaded
  await page.waitForSelector('[aria-label^="Type a message"]', { timeout: 10_000 });
  await page.waitForTimeout(1_000);
}

/**
 * Lists recent WhatsApp chats.
 *
 * @param limit - Maximum number of chats to return.
 * @param unreadOnly - When true, only returns chats with unread messages.
 */
export async function listChats(
  limit: number = 20,
  unreadOnly: boolean = false,
): Promise<WhatsAppChat[]> {
  const session = await createWhatsAppSession();
  try {
    await ensureLoggedIn(session.page);
    const page = session.page;
    await page.waitForTimeout(1_000);

    // If filtering by unread, click the Unread tab to get WhatsApp's own filtered list
    if (unreadOnly) {
      const unreadTab = page.locator('[aria-label="chat-list-filters"] [role="tab"]').filter({ hasText: /^Unread/ });
      if (await unreadTab.count() > 0) {
        await unreadTab.first().click();
        await page.waitForTimeout(1_000);
      }
    }

    // Scroll through the virtualized chat list to force all items to render
    let lastRowCount = 0;
    for (let i = 0; i < 40; i++) {
      const rowCount: number = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return 0;
        el.scrollTop += 600;
        return el.querySelectorAll('[role="row"]').length;
      }, CHAT_LIST_SELECTOR);
      await page.waitForTimeout(300);
      if (rowCount === lastRowCount) break;
      lastRowCount = rowCount;
    }
    // Scroll back to top so results are ordered newest-first
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (el) el.scrollTop = 0;
    }, CHAT_LIST_SELECTOR);
    await page.waitForTimeout(500);

    const chats = await page.evaluate(
      ({ maxChats, chatListSel }: { maxChats: number; chatListSel: string }) => {
        const results: Array<{
          name: string;
          lastMessage: string;
          timestamp: string;
          unread: boolean;
          unreadCount: number;
        }> = [];

        const rows = document.querySelectorAll(`${chatListSel} [role="row"]`);

        for (let i = 0; i < Math.min(rows.length, maxChats); i++) {
          const row = rows[i];

          // Name: first span with a title attribute
          const spans = row.querySelectorAll('span[title]');
          const name = spans[0]?.getAttribute('title')?.trim() || '';

          // Last message: second span with title (has full message text as title)
          const lastMessage = spans[1]?.textContent?.trim().replace(/^status-\S+/, '').trim() || '';

          // Timestamp: extract from full text by removing name and lastMessage
          const fullText = row.textContent?.trim() || '';
          const afterName = fullText.slice(name.length).trim();
          const timestampMatch = afterName.match(/^(\d{1,2}:\d{2}(?:\s?[ap]\.m\.)?|\w+)/i);
          const timestamp = timestampMatch?.[1] || '';

          // Unread count
          const unreadEl = row.querySelector('span[aria-label*="unread"]');
          const unreadCount = parseInt(unreadEl?.textContent?.trim() || '0', 10) || 0;
          const unread = unreadCount > 0;

          if (name && lastMessage !== 'Loading…') results.push({ name, lastMessage, timestamp, unread, unreadCount });
        }

        return results;
      },
      { maxChats: limit * 2, chatListSel: CHAT_LIST_SELECTOR },
    );

    const filtered = unreadOnly ? chats.filter((c) => c.unread) : chats;
    return filtered.slice(0, limit);
  } finally {
    await closeWhatsAppSession(session);
  }
}

/**
 * Reads messages from a WhatsApp chat by name.
 *
 * @param chatName - Display name of the chat to read.
 * @param limit - Maximum number of recent messages to return.
 */
export async function readChat(
  chatName: string,
  limit: number = 50,
): Promise<WhatsAppMessage[]> {
  const session = await createWhatsAppSession();
  try {
    await ensureLoggedIn(session.page);
    const page = session.page;

    await openChat(page, chatName);

    // Wait for messages to appear
    await page.waitForSelector('.message-in, .message-out', { timeout: 15_000 });
    await page.waitForTimeout(1_000);

    const messages = await page.evaluate((maxMessages: number) => {
      const results: Array<{
        sender: string;
        body: string;
        timestamp: string;
        isMe: boolean;
      }> = [];

      const msgs = [...document.querySelectorAll('.message-in, .message-out')].slice(-maxMessages);

      for (const msg of msgs) {
        const isMe = msg.classList.contains('message-out');

        // Find the top-level data-pre-plain-text with a timestamp (e.g. "[10:55 p.m., 2026-03-13] Howard Tam: ")
        const prePlainEls = [...msg.querySelectorAll('[data-pre-plain-text]')].filter((el) =>
          /\[\d{1,2}:\d{2}/.test(el.getAttribute('data-pre-plain-text') || ''),
        );
        if (prePlainEls.length === 0) continue;

        const mainEl = prePlainEls[0];
        const prePlain = mainEl.getAttribute('data-pre-plain-text') || '';
        const tsMatch = prePlain.match(/\[([^\]]+)\]/);
        const timestamp = tsMatch?.[1] || '';
        const senderFromAttr = prePlain.replace(/\[[^\]]+\]\s*/, '').replace(/:$/, '').trim();

        // Clone, strip quoted messages, strip trailing time display
        const clone = mainEl.cloneNode(true) as Element;
        clone.querySelectorAll('[aria-label="Quoted message"]').forEach((q) => q.remove());
        let body = clone.textContent?.trim() || '';
        body = body.replace(/\s*\d{1,2}:\d{2}(?:\s*[ap]\.m\.)?$/, '').trim();

        if (body) {
          results.push({
            sender: isMe ? 'Me' : senderFromAttr || 'Unknown',
            body,
            timestamp,
            isMe,
          });
        }
      }

      return results;
    }, limit);

    return messages;
  } finally {
    await closeWhatsAppSession(session);
  }
}

/**
 * Sends a message to a WhatsApp chat by name.
 * Types character-by-character with randomised delays to mimic natural input.
 *
 * @param chatName - Display name of the chat to send to.
 * @param message - Message text. Use `\n` for line breaks (rendered as Shift+Enter).
 */
export async function sendWhatsAppMessage(chatName: string, message: string): Promise<void> {
  const session = await createWhatsAppSession();
  try {
    await ensureLoggedIn(session.page);
    const page = session.page;

    await openChat(page, chatName);

    const composeBox = await page.waitForSelector(
      '[aria-label^="Type a message"]',
      { timeout: 10_000 },
    );
    await composeBox.click();
    await page.waitForTimeout(300);

    // Type character by character; use Shift+Enter for line breaks
    const lines = message.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const char of lines[i]) {
        await page.keyboard.type(char);
        await page.waitForTimeout(40 + Math.random() * 40);
      }
      if (i < lines.length - 1) {
        await page.keyboard.press('Shift+Enter');
      }
    }

    await page.waitForTimeout(300 + Math.random() * 200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_000);
  } finally {
    await closeWhatsAppSession(session);
  }
}

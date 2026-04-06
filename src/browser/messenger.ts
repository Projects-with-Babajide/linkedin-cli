import { Page } from 'playwright';
import { createMessengerSession, closeMessengerSession } from './messenger-session';

const MESSENGER_URL = 'https://www.messenger.com/';
const LOAD_TIMEOUT = 60_000;
// Long timeout — user may need to complete email, password, 2FA, and checkpoint steps
const LOGIN_TIMEOUT = 300_000;

const CHAT_GRID_SELECTOR = '[role="grid"][aria-label="Chats"]';
const SEARCH_INPUT_SELECTOR = 'input[aria-label="Search Messenger"]';
const COMPOSE_BOX_SELECTOR = '[role="textbox"][aria-label="Message"]';
const LOGIN_INPUT_SELECTOR = 'input[aria-label="Email or phone number"]';

export interface MessengerChat {
  id: string;
  name: string;
  lastMessage: string;
  timestamp: string;
  unread: boolean;
}

export interface MessengerMessage {
  sender: string;
  body: string;
  timestamp: string;
  isMe: boolean;
}

/**
 * Navigates to Messenger and waits for the user to log in if not already authenticated.
 * Handles multi-step Facebook auth: email → password → 2FA → security checkpoint.
 * On subsequent runs the persistent profile restores the session automatically.
 */
async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto(MESSENGER_URL, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
  await page.waitForTimeout(3_000);

  // Check if login fields are visible (works regardless of URL)
  const loginVisible = await page
    .isVisible(LOGIN_INPUT_SELECTOR, { timeout: 3_000 })
    .catch(() => false);

  if (!loginVisible) {
    // Already logged in — wait briefly for the UI to settle
    await page.waitForTimeout(2_000);
    return;
  }

  process.stderr.write('[messenger] Not logged in — please complete login in the browser window (including any security checks)...\n');
  process.stderr.write('[messenger] Waiting up to 5 minutes...\n');

  // Wait until login fields disappear (user has completed login + any checkpoints)
  const deadline = Date.now() + LOGIN_TIMEOUT;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2_000);
    const stillOnLogin = await page
      .isVisible(LOGIN_INPUT_SELECTOR, { timeout: 1_000 })
      .catch(() => false);
    if (!stillOnLogin) {
      await page.waitForTimeout(3_000);
      process.stderr.write('[messenger] Logged in successfully.\n');
      return;
    }
  }

  throw new Error('Login timed out — please try again and complete all login steps within 5 minutes.');
}

/**
 * Opens a conversation by name using the Messenger search box.
 */
async function openConversation(page: Page, chatName: string): Promise<void> {
  // Navigate to inbox first to ensure search is available
  if (!page.url().startsWith(MESSENGER_URL)) {
    await page.goto(MESSENGER_URL, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    await page.waitForTimeout(2_000);
  }

  const searchInput = await page.waitForSelector(SEARCH_INPUT_SELECTOR, { timeout: 10_000 });
  await searchInput.click();
  await page.waitForTimeout(500);
  await page.keyboard.type(chatName);
  await page.waitForTimeout(1_500);

  // Results appear in a listbox
  const resultsList = page.locator('[role="listbox"]').first();
  await resultsList.waitFor({ timeout: 8_000 });

  const firstResult = resultsList.locator('[role="option"]').first();
  await firstResult.click();
  await page.waitForTimeout(1_500);

  // Confirm conversation opened
  await page.waitForSelector(COMPOSE_BOX_SELECTOR, { timeout: 10_000 });
  await page.waitForTimeout(800);
}

/**
 * Lists recent Messenger conversations.
 *
 * @param limit - Maximum number of conversations to return.
 * @param unreadOnly - When true, only returns conversations with unread messages.
 */
export async function listChats(
  limit: number = 20,
  unreadOnly: boolean = false,
): Promise<MessengerChat[]> {
  const session = await createMessengerSession();
  try {
    await ensureLoggedIn(session.page);
    const page = session.page;

    // Navigate to inbox to ensure the chat list is visible
    await page.goto(MESSENGER_URL, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    await page.waitForSelector(CHAT_GRID_SELECTOR, { timeout: 15_000 });
    await page.waitForTimeout(1_500);

    const chats = await page.evaluate(
      ({ maxChats, gridSel }: { maxChats: number; gridSel: string }) => {
        const results: Array<{
          id: string;
          name: string;
          lastMessage: string;
          timestamp: string;
          unread: boolean;
        }> = [];

        const grid = document.querySelector(gridSel);
        if (!grid) return results;

        // All conversation links — exclude nav links (which have ?focus_target= in href)
        const links = [...grid.querySelectorAll('a[href*="/t/"]')].filter(
          (a) => !a.getAttribute('href')?.includes('focus_target'),
        ) as HTMLAnchorElement[];

        for (const link of links.slice(0, maxChats * 2)) {
          const href = link.getAttribute('href') || '';
          const text = link.textContent?.trim() || '';

          // ID from href — handle both /t/ and /e2ee/t/ paths
          const idMatch = href.match(/\/(?:e2ee\/)?t\/([^/?]+)/);
          const id = idMatch?.[1] || '';
          if (!id) continue;

          const isUnread = text.includes('Unread message:');

          // Name: look for the nearest "More options for X" button (most reliable)
          const row = link.closest('[class]');
          const moreBtn = row?.querySelector('[aria-label^="More options for"]');
          const nameFromBtn = moreBtn?.getAttribute('aria-label')?.replace('More options for ', '').trim();
          const nameFromText = isUnread
            ? text.split('Unread message:')[0].trim()
            : text.split('  ·')[0].trim();
          const name = nameFromBtn || nameFromText;

          // Timestamp from ABBR element
          const abbr = row?.querySelector('abbr[aria-label]');
          const timestamp = abbr?.getAttribute('aria-label') || '';

          // Last message
          let lastMessage = '';
          if (isUnread) {
            lastMessage = text.split('Unread message:')[1]?.split('  ·')[0]?.trim() || '';
          }

          if (name && id) {
            results.push({ id, name, lastMessage, timestamp, unread: isUnread });
          }
        }

        return results;
      },
      { maxChats: limit, gridSel: CHAT_GRID_SELECTOR },
    );

    // De-duplicate (virtualized list can yield dupes)
    const seen = new Set<string>();
    const deduped = chats.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    const filtered = unreadOnly ? deduped.filter((c) => c.unread) : deduped;
    return filtered.slice(0, limit);
  } finally {
    await closeMessengerSession(session);
  }
}

/**
 * Reads messages from a Messenger conversation by name.
 *
 * @param chatName - Display name of the conversation to read.
 * @param limit - Maximum number of recent messages to return.
 */
export async function readChat(
  chatName: string,
  limit: number = 50,
): Promise<MessengerMessage[]> {
  const session = await createMessengerSession();
  try {
    await ensureLoggedIn(session.page);
    const page = session.page;

    await openConversation(page, chatName);

    // Wait for message grid
    await page.waitForSelector('[role="grid"][aria-label*="Messages in conversation"]', {
      timeout: 15_000,
    });
    await page.waitForTimeout(1_000);

    const messages = await page.evaluate((maxMessages: number) => {
      const results: Array<{
        sender: string;
        body: string;
        timestamp: string;
        isMe: boolean;
      }> = [];

      const grid = document.querySelector('[role="grid"][aria-label*="Messages in conversation"]');
      if (!grid) return results;

      // Each row in the message grid is a message or a date separator
      const rows = [...grid.querySelectorAll('[role="row"]')].slice(-maxMessages);

      for (const row of rows) {
        // Skip date separators (no text content in a div[dir])
        const bodyEl = row.querySelector('[dir="auto"]');
        const body = bodyEl?.textContent?.trim() || '';
        if (!body) continue;

        // Outgoing messages are typically right-aligned or marked with a specific attribute
        // Look for the sender avatar / name hint in the row
        const hasAvatar = !!row.querySelector('[role="img"]');
        // Outgoing rows don't have an avatar; incoming rows do
        const isMe = !hasAvatar;

        // Timestamp from ABBR
        const abbr = row.querySelector('abbr[aria-label], abbr[title]');
        const timestamp =
          abbr?.getAttribute('aria-label') ||
          abbr?.getAttribute('title') ||
          abbr?.textContent?.trim() ||
          '';

        // Sender name from img aria-label (e.g. "Reg Rosauro")
        const imgEl = row.querySelector('[role="img"][aria-label]');
        const sender = isMe ? 'Me' : imgEl?.getAttribute('aria-label') || 'Them';

        results.push({ sender, body, timestamp, isMe });
      }

      return results;
    }, limit);

    return messages;
  } finally {
    await closeMessengerSession(session);
  }
}

/**
 * Sends a message in a Messenger conversation by name.
 * Types character-by-character with randomised delays to mimic natural input.
 *
 * @param chatName - Display name of the conversation to send to.
 * @param message - Message text. Use `\n` for line breaks (rendered as Shift+Enter).
 */
export async function sendMessengerMessage(chatName: string, message: string): Promise<void> {
  const session = await createMessengerSession();
  try {
    await ensureLoggedIn(session.page);
    const page = session.page;

    await openConversation(page, chatName);

    const composeBox = await page.waitForSelector(COMPOSE_BOX_SELECTOR, { timeout: 10_000 });
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
    await closeMessengerSession(session);
  }
}

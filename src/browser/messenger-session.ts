import * as path from 'path';
import * as os from 'os';
import { chromium, BrowserContext, Page } from 'playwright';

// Persistent profile directory — stores cookies, localStorage, IndexedDB, etc.
// Messenger requires a full browser profile to survive across runs without re-login.
const MESSENGER_PROFILE_DIR = path.join(os.homedir(), '.link-pulse', 'messenger-profile');

export interface MessengerSession {
  context: BrowserContext;
  page: Page;
}

/**
 * Creates a Playwright persistent browser context for Messenger.
 * Always runs in non-headless mode — Facebook detects and blocks headless browsers.
 * The full browser profile is stored on disk so the session survives across runs
 * without requiring the user to log in again.
 */
export async function createMessengerSession(): Promise<MessengerSession> {
  const context = await chromium.launchPersistentContext(MESSENGER_PROFILE_DIR, {
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await context.newPage();
  return { context, page };
}

/**
 * Closes the Messenger browser session.
 * The profile is already persisted to disk by launchPersistentContext — no explicit save needed.
 */
export async function closeMessengerSession(session: MessengerSession): Promise<void> {
  await session.context.close();
}

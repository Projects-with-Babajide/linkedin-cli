import * as path from 'path';
import * as os from 'os';
import { chromium, BrowserContext, Page } from 'playwright';

// Persistent profile directory — stores cookies, localStorage, IndexedDB, etc.
// WhatsApp Web requires IndexedDB for session persistence; storageState() does not capture it.
const WA_PROFILE_DIR = path.join(os.homedir(), '.link-pulse', 'whatsapp-profile');

export interface WhatsAppSession {
  context: BrowserContext;
  page: Page;
}

/**
 * Creates a Playwright persistent browser context for WhatsApp Web.
 * Always runs in non-headless mode — WhatsApp Web detects and blocks headless browsers.
 * The full browser profile (including IndexedDB) is stored on disk so the session
 * survives across runs without requiring a QR code re-scan.
 */
export async function createWhatsAppSession(): Promise<WhatsAppSession> {
  const context = await chromium.launchPersistentContext(WA_PROFILE_DIR, {
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await context.newPage();
  return { context, page };
}

/**
 * Closes the WhatsApp browser session.
 * The profile is already persisted to disk by launchPersistentContext — no explicit save needed.
 */
export async function closeWhatsAppSession(session: WhatsAppSession): Promise<void> {
  await session.context.close();
}

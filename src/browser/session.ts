import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { loadCookies, saveCookies } from '../storage/keytar-store';
import { getContext } from '../utils/context';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function createBrowserSession(): Promise<BrowserSession> {
  const { headless } = getContext();

  const cookieState = await loadCookies();

  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let context: BrowserContext;
  if (cookieState) {
    try {
      const storageState = JSON.parse(cookieState);
      context = await browser.newContext({ storageState });
    } catch {
      context = await browser.newContext();
    }
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();
  return { browser, context, page };
}

export async function saveBrowserSession(context: BrowserContext): Promise<void> {
  const state = await context.storageState();
  await saveCookies(JSON.stringify(state));
}

export async function closeBrowserSession(session: BrowserSession): Promise<void> {
  await saveBrowserSession(session.context);
  await session.browser.close();
}

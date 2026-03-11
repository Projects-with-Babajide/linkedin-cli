import { Page } from 'playwright';
import { CliException, ErrorCode } from '../utils/errors';

export function randomDelay(min = 300, max = 1200): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

export async function safeClick(page: Page, selector: string): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout: 10000 });
  } catch {
    throw new CliException(`Selector not found: ${selector}`, ErrorCode.SELECTOR_ERROR);
  }
  await randomDelay();
  await page.click(selector);
}

export async function safeType(page: Page, selector: string, text: string): Promise<void> {
  await safeClick(page, selector);
  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 100 + 50) });
  }
}

export async function checkForBlock(page: Page): Promise<void> {
  const url = page.url();
  if (url.includes('checkpoint') || url.includes('challenge')) {
    throw new CliException(
      'LinkedIn is requesting verification. Open LinkedIn in your browser to resolve.',
      ErrorCode.LINKEDIN_BLOCKED
    );
  }
}

export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto('https://www.linkedin.com/feed', { waitUntil: 'domcontentloaded' });
  const url = page.url();
  if (url.includes('/login') || url.includes('/authwall') || url.includes('/uas/login')) {
    throw new CliException(
      'Not logged in. Run: linkedin auth login',
      ErrorCode.AUTH_REQUIRED
    );
  }
  await checkForBlock(page);
}

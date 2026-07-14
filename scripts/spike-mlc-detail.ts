// Day-1 spike, phase 3: from a search results page, open the first work's
// detail view and capture the XHR that loads writers/publishers/shares.
// Output: fixtures/recon3/.

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

chromium.use(stealth());

const OUT = join(import.meta.dirname, '..', 'fixtures', 'recon3');
mkdirSync(OUT, { recursive: true });

const QUERY = process.argv[2] ?? 'Speedometer';

const netLog: { method: string; url: string; status?: number; requestBody?: string }[] = [];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });

  page.on('response', async (res) => {
    const req = res.request();
    if (!['xhr', 'fetch'].includes(req.resourceType())) return;
    if (!res.url().includes('api.ptl.themlc.com')) return;
    netLog.push({
      method: req.method(),
      url: res.url(),
      status: res.status(),
      requestBody: req.postData() ?? undefined,
    });
    try {
      const body = await res.text();
      if (body.length > 2) {
        const safe = res.url().replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 120);
        writeFileSync(join(OUT, `resp_${Date.now()}_${safe}.json`), body);
      }
    } catch { /* ignore */ }
  });

  await page.goto('https://portal.themlc.com/search', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('#CybotCookiebotDialogBodyButtonDecline, button:has-text("Use necessary cookies only")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.locator('#modal-root button:has-text("Continue")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);

  const input = page.locator('input[type="text"]:visible, input[type="search"]:visible').first();
  await input.click();
  await input.pressSequentially(QUERY, { delay: 60 });
  await page.locator('button:has-text("Search")').first().click();
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, 'results.png'), fullPage: true });

  // Click the first result row — try common row/link patterns, log what we see.
  const candidates = [
    'table tbody tr',
    '[class*="result" i] a',
    '[class*="row" i][class*="work" i]',
    'a[href*="work"]',
  ];
  let clicked = false;
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      console.log(`→ clicking first match of: ${sel}`);
      await loc.click({ timeout: 8000 }).catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) console.log('! no result row matched known selectors');

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(4000);
  writeFileSync(join(OUT, 'detail-page.html'), await page.content());
  await page.screenshot({ path: join(OUT, 'detail.png'), fullPage: true });
  writeFileSync(join(OUT, 'network-log.json'), JSON.stringify(netLog, null, 2));
  console.log(`→ done. URL now: ${page.url()}; ${netLog.length} API calls captured`);
  await browser.close();
}

main().catch((err) => {
  console.error('SPIKE FAILED:', err);
  process.exit(1);
});

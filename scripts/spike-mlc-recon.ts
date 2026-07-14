// Day-1 spike, phase 1: reconnaissance of the MLC public work search.
// Goals: does stealth headless Chromium get past bot detection, and does the
// SPA talk to a JSON API we can read directly instead of scraping DOM?
// Saves screenshot + HTML + a log of all XHR/fetch traffic to fixtures/recon/.

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

chromium.use(stealth());

const OUT = join(import.meta.dirname, '..', 'fixtures', 'recon');
mkdirSync(OUT, { recursive: true });

const QUERY = process.argv[2] ?? 'Speedometer';

type NetLogEntry = {
  method: string;
  url: string;
  status?: number;
  contentType?: string;
  requestBody?: string;
  responsePreview?: string;
};
const netLog: NetLogEntry[] = [];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  page.on('response', async (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (type !== 'xhr' && type !== 'fetch') return;
    const entry: NetLogEntry = {
      method: req.method(),
      url: res.url(),
      status: res.status(),
      contentType: res.headers()['content-type'],
      requestBody: req.postData() ?? undefined,
    };
    try {
      const body = await res.text();
      entry.responsePreview = body.slice(0, 3000);
      // Save full JSON bodies — these are the candidate API responses.
      if (entry.contentType?.includes('json') && body.length > 2) {
        const safe = res
          .url()
          .replace(/^https?:\/\//, '')
          .replace(/[^a-zA-Z0-9.-]/g, '_')
          .slice(0, 150);
        writeFileSync(join(OUT, `resp_${Date.now()}_${safe}.json`), body);
      }
    } catch {
      // response body unavailable (e.g. redirect) — keep the metadata entry
    }
    netLog.push(entry);
  });

  console.log('→ navigating to portal.themlc.com/search …');
  await page.goto('https://portal.themlc.com/search', {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await page.waitForTimeout(3000);

  writeFileSync(join(OUT, 'search-page.html'), await page.content());
  await page.screenshot({ path: join(OUT, 'search-page.png'), fullPage: true });
  console.log('→ landing page captured. Title:', await page.title());

  // Try to find a search input and run the query.
  const input = page
    .locator(
      'input[type="search"], input[type="text"], input[placeholder*="earch" i], input[formcontrolname*="search" i]',
    )
    .first();
  if (await input.count()) {
    console.log(`→ found search input, querying "${QUERY}" …`);
    await input.click();
    await input.pressSequentially(QUERY, { delay: 90 });
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(5000);
    writeFileSync(join(OUT, 'results-page.html'), await page.content());
    await page.screenshot({ path: join(OUT, 'results-page.png'), fullPage: true });
    console.log('→ results page captured. URL:', page.url());
  } else {
    console.log('! no search input found on the page');
  }

  writeFileSync(join(OUT, 'network-log.json'), JSON.stringify(netLog, null, 2));
  console.log(`→ ${netLog.length} XHR/fetch calls logged to fixtures/recon/network-log.json`);
  await browser.close();
}

main().catch((err) => {
  console.error('SPIKE FAILED:', err);
  process.exit(1);
});

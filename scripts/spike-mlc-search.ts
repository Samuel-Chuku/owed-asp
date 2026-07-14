// Day-1 spike, phase 2: dismiss overlays, run a real Work search, and capture
// the underlying search API request/response. Output: fixtures/recon2/.

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

chromium.use(stealth());

const OUT = join(import.meta.dirname, '..', 'fixtures', 'recon2');
mkdirSync(OUT, { recursive: true });

const QUERY = process.argv[2] ?? 'Speedometer';

type NetLogEntry = {
  method: string;
  url: string;
  status?: number;
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
    if (!res.url().includes('themlc.com')) return;
    const entry: NetLogEntry = {
      method: req.method(),
      url: res.url(),
      status: res.status(),
      requestBody: req.postData() ?? undefined,
    };
    try {
      const body = await res.text();
      entry.responsePreview = body.slice(0, 1500);
      if (body.length > 2 && body.trim().startsWith('{')) {
        const safe = res
          .url()
          .replace(/^https?:\/\//, '')
          .replace(/[^a-zA-Z0-9.-]/g, '_')
          .slice(0, 120);
        writeFileSync(join(OUT, `resp_${Date.now()}_${safe}.json`), body);
      }
    } catch {
      /* body unavailable */
    }
    netLog.push(entry);
  });

  console.log('→ navigating …');
  await page.goto('https://portal.themlc.com/search', {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });

  // 1. Cookiebot banner
  const cookieBtn = page.locator('#CybotCookiebotDialogBodyButtonDecline, button:has-text("Use necessary cookies only")').first();
  if (await cookieBtn.count()) {
    await cookieBtn.click({ timeout: 5000 }).catch(() => {});
    console.log('→ cookie banner dismissed');
  }
  await page.waitForTimeout(1000);

  // 2. Welcome modal — find any button/close control inside #modal-root
  const modal = page.locator('#modal-root');
  if (await modal.locator('button, [class*="close" i], [aria-label*="close" i]').count()) {
    const btns = modal.locator('button');
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      console.log(`   modal button[${i}]: "${(await btns.nth(i).innerText().catch(() => '')).trim()}"`);
    }
    // click the last button (usually the confirm/OK) — fall back to Escape
    if (n > 0) await btns.last().click({ timeout: 5000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    console.log('→ welcome modal handled');
  }
  await page.waitForTimeout(1000);

  // 3. Run the search from the Work tab
  const input = page.locator('input[type="text"]:visible, input[type="search"]:visible').first();
  await input.click();
  await input.pressSequentially(QUERY, { delay: 80 });
  await page.locator('button:has-text("Search")').first().click();
  console.log('→ search submitted, waiting for results …');
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(4000);

  writeFileSync(join(OUT, 'results-page.html'), await page.content());
  await page.screenshot({ path: join(OUT, 'results-page.png'), fullPage: true });
  writeFileSync(join(OUT, 'network-log.json'), JSON.stringify(netLog, null, 2));
  console.log(`→ done. ${netLog.length} themlc.com XHR calls logged. URL now: ${page.url()}`);
  await browser.close();
}

main().catch((err) => {
  console.error('SPIKE FAILED:', err);
  process.exit(1);
});

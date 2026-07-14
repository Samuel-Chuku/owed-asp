// Spike: does the MLC portal support pre-filled search via URL params?
// If yes, unregistered-track evidence links can deep-link the search.

import { chromium } from 'playwright';

const CANDIDATES = [
  'https://portal.themlc.com/search?combinedTitles=EYO',
  'https://portal.themlc.com/search?title=EYO',
  'https://portal.themlc.com/search?q=EYO',
  'https://portal.themlc.com/search#work?combinedTitles=EYO',
];

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const url of CANDIDATES) {
    await p.goto(url, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const val = await p
      .locator('input[type="text"]:visible, input[type="search"]:visible')
      .first()
      .inputValue()
      .catch(() => '(no input)');
    console.log(`${url} → input value: "${val}"`);
  }
  await b.close();
}
main();

import { chromium } from 'playwright';

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
  await p.goto('http://localhost:8402/r/8c9c6e51-7c41-4806-a9d9-9a0690719063');
  await p.screenshot({ path: '/tmp/claude-1000/-home-hirving-BrainChildren-okx-ASP/1b073ef1-2540-471d-b4fd-fa4c13718182/scratchpad/report-top.png' });
  await p.setViewportSize({ width: 420, height: 900 });
  await p.screenshot({ path: '/tmp/claude-1000/-home-hirving-BrainChildren-okx-ASP/1b073ef1-2540-471d-b4fd-fa4c13718182/scratchpad/report-mobile.png' });
  await b.close();
  console.log('shots saved');
}
main();

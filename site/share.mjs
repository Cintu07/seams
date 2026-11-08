// renders share.html into assets/share.png, the picture a link to the site unfurls into
import { chromium } from 'file:///C:/Users/pavan/Desktop/seems/web/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(new URL('./share.html', import.meta.url).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('./assets/share.png', import.meta.url).pathname.replace(/^\//, '') });
await browser.close();

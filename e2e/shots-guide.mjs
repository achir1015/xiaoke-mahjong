// 截圖：遊戲說明各單元與「關於與更新」（node e2e/shots-guide.mjs）
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eSmoke'] });
const win = await app.firstWindow();
await win.setViewportSize({ width: Number(process.env.W || 1500), height: Number(process.env.H || 900) }).catch(() => {});
await win.waitForSelector('#startAI');
await win.evaluate(() => document.querySelectorAll('.modal-back').forEach((b) => b.remove()));
await win.click('#btnGuide');
await win.waitForSelector('.gd-tile');
for (const [i, step, name] of [[4, 0, 'g1-win'], [5, 2, 'g2-tai'], [7, 1, 'g3-money'], [8, 6, 'g4-talk']]) {
  await win.click(`.gd-item[data-i="${i}"]`);
  for (let k = 0; k < step; k++) await win.click('#gdNext');
  await win.waitForTimeout(1600);
  await win.screenshot({ path: `e2e/out/${name}.png` });
}
await win.click('.gd-item[data-i="p"]');
await win.click('.gd-ctrl .primary');
await win.waitForTimeout(500);
await win.click('.gd-tiles.pick .gd-tile');
await win.waitForTimeout(600);
await win.screenshot({ path: 'e2e/out/g5-practice.png' });
await win.click('.gd-back');
await win.click('#btnAbout');
await win.waitForFunction(() => !/正在檢查/.test(document.querySelector('.upd-status').textContent), null, { timeout: 20000 }).catch(() => {});
await win.screenshot({ path: 'e2e/out/u1-about.png' });
await app.close();

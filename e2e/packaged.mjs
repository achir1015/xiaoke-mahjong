// 打包後的程式冒煙測試：node e2e/packaged.mjs <exe 路徑> [截圖]
import { _electron as electron } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import os from 'os';

const exe = process.argv[2];
const shot = process.argv[3];
fs.rmSync(path.join(process.env.APPDATA || os.homedir(), 'xiaoke-mahjong-e2ePkg'), { recursive: true, force: true });
const app = await electron.launch({ executablePath: exe, args: ['--profile=e2ePkg'] });
const win = await app.firstWindow();
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.pf-grid', { timeout: 30000 });
await win.evaluate(async () => {
  window.__xkm.settings = await window.xk.settings.set({ profile: { avatar: 'm01', advisor: 'am01' }, music: { autoplay: false }, voiceCall: false });
  document.querySelectorAll('.modal-back').forEach((b) => b.remove());
});
const tracks = await win.evaluate(() => window.xk.music.list().then((l) => l.length));
await win.click('#startAI');
await win.waitForTimeout(3500);
const r = await win.evaluate(async () => {
  const S = window.__xkm;
  for (let i = 0; i < 100 && !S.opts.some((o) => o.type === 'discard'); i++) await new Promise((res) => setTimeout(res, 200));
  const me = S.view.players[S.mySeat];
  const id = me.drawn >= 0 ? me.drawn : me.hand[0];
  window.__xkmTable.onTileClick(id); window.__xkmTable.onTileClick(id);
  await new Promise((res) => setTimeout(res, 1500));
  const a = new Audio('app://local/assets/music/track05.mp3');
  await a.play().catch(() => null);
  await new Promise((res) => setTimeout(res, 1200));
  return { river: S.view.players[S.mySeat].river.length, audio: a.currentTime > 0.3, tiles: window.__xkmTable.objs.size, version: S.info.version, packaged: S.info.packaged };
});
if (shot) await win.screenshot({ path: shot });
console.log(JSON.stringify({ tracks, ...r, errors }, null, 1));
await app.close();

// 手機版網頁測試（在電腦用手機尺寸模擬）：node e2e/mobile.mjs
// 先執行 node scripts/build-mobile.mjs 產生 mobile/www
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('mobile/www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(8765);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 832, height: 384 }, deviceScaleFactor: 2.8, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S9380) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' });
const win = await ctx.newPage();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const waitFor = async (fn, arg, ms = 30000) => { const t = Date.now(); for (;;) { const v = await win.evaluate(fn, arg).catch(() => false); if (v) return v; if (Date.now() - t > ms) throw new Error('等待逾時：' + fn); await new Promise((r) => setTimeout(r, 150)); } };
const shot = (n) => win.screenshot({ path: `e2e/out/m-${n}.png` });
const fits = () => win.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, vw: innerWidth, vh: innerHeight }));

try {
  await win.goto('http://127.0.0.1:8765/index.html');
  await win.waitForSelector('.pf-grid', { timeout: 20000 });
  check('手機版啟動並要求選頭像', await win.evaluate(() => document.documentElement.classList.contains('mobile')));
  await shot('1-picker');
  await win.tap('.pf-item[data-key="avatar"]');
  await win.tap('.pf-tab[data-k="advisor"]');
  await win.tap('.pf-item[data-key="advisor"]');
  await win.tap('.modal .pf-ok');
  await win.waitForSelector('#startAI');
  await win.evaluate(async () => { await window.xk.settings.set({ music: { autoplay: false }, voiceCall: false }); });
  const f1 = await fits();
  check('首頁不超出寬度', f1.w <= f1.vw, JSON.stringify(f1));
  await shot('2-home');
  await win.selectOption('#lenAI', 'hand1');
  await win.tap('#startAI');
  await waitFor(() => window.__xkm.view && window.__xkm.hand && !document.querySelector('.versus'), null, 20000);
  const f2 = await fits();
  check('牌桌不超出畫面', f2.w <= f2.vw && f2.h <= f2.vh, JSON.stringify(f2));
  const right = await win.evaluate(() => getComputedStyle(document.querySelector('.right')).transform !== 'none');
  check('軍師面板預設收起來（抽屜）', right);
  await win.waitForTimeout(800);
  await shot('3-table');
  await win.tap('#btnDrawer');
  await win.waitForTimeout(400);
  check('按 ☰ 打開抽屜', await win.evaluate(() => document.documentElement.classList.contains('drawer-open')));
  await shot('4-drawer');
  await win.tap('#drawerShade', { position: { x: 100, y: 200 } });
  check('點旁邊關閉抽屜', await win.evaluate(() => !document.documentElement.classList.contains('drawer-open')));
  // 打完這局
  const t0 = Date.now();
  for (;;) {
    const st = await win.evaluate(() => { const S = window.__xkm; return { over: !!S.view.result, opts: S.opts.map((o) => o.type) }; });
    if (st.over) break;
    if (Date.now() - t0 > 180000) throw new Error('打太久');
    if (st.opts.includes('tsumo') || st.opts.includes('hu')) await win.tap('.act.win');
    else if (st.opts.includes('discard')) await win.evaluate(() => { const S = window.__xkm; const me = S.view.players[S.mySeat]; const id = me.drawn >= 0 ? me.drawn : me.hand[0]; window.__xkmTable.onTileClick(id); window.__xkmTable.onTileClick(id); });
    else if (st.opts.includes('pass')) await win.tap('.act.pass');
    await win.waitForTimeout(120);
  }
  await waitFor(() => document.querySelector('.modal .result'), null, 15000);
  const f3 = await win.evaluate(() => { const m = document.querySelector('.modal').getBoundingClientRect(); return { r: m.right, b: m.bottom, vw: innerWidth, vh: innerHeight }; });
  check('結算視窗在畫面內', f3.r <= f3.vw && f3.b <= f3.vh, JSON.stringify(f3));
  await shot('5-result');
  // 返回鍵：關對話框
  check('返回鍵先關掉對話框', await win.evaluate(() => window.__xkBack() && !document.querySelector('.modal .result')));
  await win.waitForTimeout(300);
  await win.evaluate(() => document.querySelectorAll('.modal-back').forEach((b) => b.remove()));
  await win.evaluate(() => window.__xkBack());
  await win.waitForTimeout(300);
  await win.evaluate(() => document.querySelectorAll('.modal-back .modal-btns button.primary').forEach((b) => b.click()));
  await win.waitForSelector('#startAI');
  // 智庫（IndexedDB）
  await win.tap('#btnKB');
  await waitFor(() => document.querySelector('.kb-stats'));
  const kb = await win.evaluate(() => ({ learned: Number(document.querySelector('.kb-card b').textContent), rows: document.querySelectorAll('.rec-table tbody tr').length }));
  check('手機版智庫有收錄並學習', kb.learned >= 1 && kb.rows >= 1, JSON.stringify(kb));
  await shot('6-kb');
  await win.evaluate(() => window.__xkBack());
  await win.waitForSelector('#startAI');
  // 說明
  await win.tap('#btnGuide');
  await win.waitForTimeout(1500);
  const g = await win.evaluate(() => { const s = document.querySelector('.gd-side').getBoundingClientRect(); const row = document.querySelector('.gd-tiles'); return { side: s.right <= innerWidth, fit: row.scrollWidth <= document.querySelector('.gd-stage').clientWidth }; });
  check('說明頁右側字幕在畫面內、牌不超出', g.side && g.fit, JSON.stringify(g));
  await shot('7-guide');
  check('沒有錯誤', errors.length === 0, errors.slice(0, 5).join('\n'));
} catch (e) {
  fail++; console.log('✘ 例外：', e.message); await shot('fail').catch(() => {}); console.log(errors.slice(0, 5).join('\n'));
} finally {
  await browser.close();
  server.close();
  console.log(`\n通過 ${pass}，失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
}

// 實機測試：透過 adb 連到手機上小柯麻將（除錯版 APK）的 WebView，用 DevTools 協定檢查功能
// 用法：python android/build.py debug install，手機解鎖後執行 node e2e/phone.mjs [手機序號]
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.argv[2] || process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const outDir = 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const shotPhone = (name) => fs.writeFileSync(path.join(outDir, 'p-' + name + '.png'), execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

// 只有本 App 在前景、螢幕沒鎖時才操作
const focus = adb('shell', 'dumpsys', 'window');
if (/isKeyguardShowing=true/.test(focus)) { console.log('手機鎖著，請先解鎖'); process.exit(2); }
const fm = focus.match(/mCurrentFocus=[^\r\n]*/g) || [];
if (!fm.some((f) => f.includes('com.achir.xiaokemahjong'))) { console.log('前景不是小柯麻將：', fm.join(' ')); process.exit(2); }
const sock = /@?(webview_devtools_remote_\d+)/.exec(adb('shell', 'cat', '/proc/net/unix'));
if (!sock) { console.log('找不到 WebView 偵錯通道（要用 python android/build.py debug 建置）'); process.exit(2); }
execFileSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9334', 'localabstract:' + sock[1]]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9334');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('appassets')) || browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const waitFor = async (fn, arg, ms = 30000) => { const t = Date.now(); for (;;) { const v = await page.evaluate(fn, arg).catch(() => false); if (v) return v; if (Date.now() - t > ms) throw new Error('等待逾時：' + fn); await new Promise((r) => setTimeout(r, 200)); } };

try {
  const info = await page.evaluate(() => ({ android: !!window.XiaokeAndroid, mobile: document.documentElement.classList.contains('mobile'), w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ver: JSON.parse(window.XiaokeAndroid.appInfo()).version, webgl: !!document.createElement('canvas').getContext('webgl2') }));
  console.log('  ', JSON.stringify(info));
  check('在 Android App 裡執行（原生橋接）', info.android && info.mobile);
  check('WebGL2（3D 牌桌）可用', info.webgl);
  check('橫向畫面', info.w > info.h);
  await page.reload();
  await waitFor(() => window.__xkm && window.__xkmTable);
  if (await page.evaluate(() => !!document.querySelector('.pf'))) {
    check('第一次開啟要選頭像', true);
    await page.evaluate(() => { document.querySelector('.pf-item[data-id="m02"]').click(); document.querySelector('.pf-tab[data-k="advisor"]').click(); document.querySelector('.pf-item[data-id="af03"]').click(); document.querySelector('.modal .pf-ok').click(); });
  }
  await page.evaluate(async () => { await window.xk.settings.set({ music: { autoplay: false } }); });
  await page.waitForTimeout(800);
  shotPhone('1-home');
  // 語音（手機原生 TTS）
  const tts = await waitFor(() => window.xk.tts && window.xk.tts.available() && window.xk.tts.voiceName(), null, 15000).catch(() => '');
  check('手機語音可用', !!tts, tts);
  const music = await page.evaluate(() => window.xk.music.list().then((l) => l.length));
  check('20 首背景音樂', music === 20, String(music));
  // 開一局
  await page.evaluate(() => { document.querySelector('#lenAI').value = 'hand1'; document.querySelector('#startAI').click(); });
  await waitFor(() => window.__xkm.view && window.__xkm.hand && !document.querySelector('.versus'), null, 20000);
  await page.waitForTimeout(1500);
  shotPhone('2-table');
  const tiles = await page.evaluate(() => window.__xkmTable.objs.size);
  check('3D 牌桌有立體牌', tiles > 60, String(tiles));
  // 打到結束
  const t0 = Date.now();
  let n = 0;
  for (;;) {
    const st = await page.evaluate(() => { const S = window.__xkm; return { over: !!S.view.result, opts: S.opts.map((o) => o.type) }; });
    if (st.over) break;
    if (Date.now() - t0 > 240000) throw new Error('打太久');
    await page.evaluate((o) => {
      const S = window.__xkm;
      const b = (sel) => { const e = document.querySelector(sel); if (e) e.click(); };
      if (o.includes('tsumo') || o.includes('hu')) b('.act.win');
      else if (o.includes('discard')) { const me = S.view.players[S.mySeat]; const id = me.drawn >= 0 ? me.drawn : me.hand[0]; window.__xkmTable.onTileClick(id); window.__xkmTable.onTileClick(id); }
      else if (o.includes('pass')) b('.act.pass');
    }, st.opts);
    if (++n === 8) shotPhone('3-midgame');
    await page.waitForTimeout(200);
  }
  await waitFor(() => document.querySelector('.modal .result'), null, 15000);
  check('打完一局並顯示結算', true);
  shotPhone('4-result');
  await page.evaluate(() => [...document.querySelectorAll('.modal-btns button')].find((b) => b.classList.contains('primary')).click());
  await page.waitForTimeout(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-btns button')].find((x) => x.textContent === '回首頁'); if (b) b.click(); });
  await waitFor(() => document.querySelector('#startAI'));
  // 智庫
  const kb = await page.evaluate(async () => ((await window.xk.kb.get()) || {}).hands || 0);
  check('手機智庫已學習這局', kb >= 1, String(kb));
  // 更新檢查（原生）
  const upd = await page.evaluate(async () => { try { return await window.xk.update.check(); } catch (e) { return { error: e.message }; } });
  check('更新檢查可以連到 GitHub', !!upd.latest, JSON.stringify(upd).slice(0, 160));
  // 說明＋語音
  await page.evaluate(() => document.querySelector('#btnGuide').click());
  await page.waitForTimeout(3000);
  const gd = await page.evaluate(() => ({ play: document.querySelector('#gdPlay').textContent, side: document.querySelector('.gd-side').getBoundingClientRect().right <= innerWidth }));
  check('說明頁自動語音講解、右側在畫面內', gd.play.includes('暫停') && gd.side, JSON.stringify(gd));
  shotPhone('5-guide');
  await page.evaluate(() => document.querySelector('#gdPlay').click());
  await page.evaluate(() => document.querySelector('.gd-back').click());
  check('沒有錯誤', errors.length === 0, errors.slice(0, 5).join('\n'));
} catch (e) {
  fail++; console.log('✘ 例外：', e.message); shotPhone('fail');
} finally {
  await browser.close().catch(() => {});
  console.log(`\n通過 ${pass}，失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
}

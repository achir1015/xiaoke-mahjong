// 遠端對戰端對端測試：本機配對伺服器＋四個程式實例
// A 房主、B、C 遠端真人（空位 AI 補）、D 開始後加入（觀眾）；B 中途請軍師代打；C 斷線由 AI 接手
// 用法：node e2e/net.mjs [截圖資料夾]
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const { PeerServer } = require('peer');
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const PORT = 9141;
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
for (const p of ['e2eA', 'e2eB', 'e2eC', 'e2eD']) fs.rmSync(path.join(appData, 'xiaoke-mahjong-' + p), { recursive: true, force: true });
const server = PeerServer({ port: PORT, path: '/' });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

async function launch(profile, name, avatar) {
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=' + profile, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION|peer|WebSocket/i.test(m.text())) errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await win.waitForSelector('.pf-grid', { timeout: 30000 });
  await win.evaluate(async ({ port, name, avatar }) => {
    window.__xkm.settings = await window.xk.settings.set({ playerName: name, profile: { avatar, advisor: 'af03' }, server: { mode: 'custom', host: '127.0.0.1', port, path: '/', secure: false }, music: { autoplay: false }, sfx: false, voiceCall: false });
    document.querySelectorAll('.modal-back').forEach((b) => b.remove());
  }, { port: PORT, name, avatar });
  await win.evaluate(() => document.querySelector('#btnAbout') && 0);
  const waitFor = async (fn, arg, ms = 30000) => {
    const t = Date.now();
    for (;;) {
      const v = await win.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(profile + ' 等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  return { app, win, errors, waitFor, name: profile };
}

// 每個真人：輪到就打剛摸的牌、吃碰就過、能胡就胡（用畫面上的按鈕與點牌）
async function autoStep(X) {
  return X.win.evaluate(() => {
    const S = window.__xkm;
    if (!S.view || S.view.result || S.proxy[S.mySeat]) return 'idle';
    const types = S.opts.map((o) => o.type);
    const btn = (sel) => { const b = document.querySelector(sel); if (b) { b.click(); return true; } return false; };
    if (types.includes('tsumo') || types.includes('hu')) return btn('.act.win') ? 'win' : 'idle';
    if (types.includes('discard')) {
      const me = S.view.players[S.mySeat];
      const id = me.drawn >= 0 ? me.drawn : me.hand[me.hand.length - 1];
      window.__xkmTable.onTileClick(id); window.__xkmTable.onTileClick(id);
      return 'discard';
    }
    if (types.includes('pass')) return btn('.act.pass') ? 'pass' : 'idle';
    return 'idle';
  }).catch(() => 'err');
}

const A = await launch('e2eA', '小明', 'm05');
const B = await launch('e2eB', '阿華', 'f07');
const C = await launch('e2eC', '小美', 'f12');
const all = [A, B, C];
let D = null;

try {
  // 建房、加入
  await A.win.selectOption('#lenNet', 'hand1');
  await A.win.click('#btnHost');
  await A.waitFor(() => /\d{3} \d{3}/.test((document.querySelector('.room-code') || {}).textContent || ''));
  const code = (await A.win.evaluate(() => document.querySelector('.room-code').textContent)).replace(/\D/g, '');
  check('房主建立房間取得 6 位數房號', code.length === 6, code);
  for (const X of [B, C]) { await X.win.fill('#joinCode', code); await X.win.click('#btnJoin'); }
  await A.waitFor(() => window.__xkm.net.members.length === 3);
  await B.waitFor(() => document.querySelectorAll('.seat-row:not(.wait)').length === 3);
  const lobby = await B.win.evaluate(() => [...document.querySelectorAll('.seat-row .who')].map((e) => e.textContent).join(','));
  check('大廳列出三位真人與一個空位', lobby.startsWith('小明,阿華,小美'), lobby);
  await B.win.screenshot({ path: path.join(outDir, 'n1-lobby.png') });

  await A.win.click('#btnStartNet');
  for (const X of all) await X.waitFor(() => window.__xkm.mode === 'net' && window.__xkm.view && !document.querySelector('.versus'), null, 30000);
  const seats = await Promise.all(all.map((X) => X.win.evaluate(() => ({ my: window.__xkm.mySeat, kinds: window.__xkm.seats.map((s) => s.kind).join(), names: window.__xkm.seats.map((s) => s.name).join() }))));
  check('三人分別坐 0、1、2 號位', seats.map((s) => s.my).join() === '0,1,2', JSON.stringify(seats));
  check('空位由 AI 補上', seats[0].kinds === 'me,remote,remote,ai', seats[0].kinds);
  check('來賓看到房主的名字', seats[1].names.startsWith('小明,阿華,小美'), seats[1].names);
  const hidden = await B.win.evaluate(() => { const v = window.__xkm.view; return { mine: !!v.players[1].hand, others: v.players.filter((p, s) => s !== 1).every((p) => p.hand === null) }; });
  check('來賓只看得到自己的手牌', hidden.mine && hidden.others, JSON.stringify(hidden));
  await B.win.screenshot({ path: path.join(outDir, 'n2-guest-table.png') });

  // 聊天
  await B.win.click('.tab[data-tab="chat"]');
  await B.win.fill('#chatInput', '大家好，今天手氣如何？');
  await B.win.press('#chatInput', 'Enter');
  await A.waitFor(() => document.querySelector('#chatLog').textContent.includes('今天手氣如何'));
  await C.waitFor(() => document.querySelector('#chatLog').textContent.includes('今天手氣如何'));
  check('文字聊天傳到房主與其他人', true);

  // D 中途加入（觀眾）
  D = await launch('e2eD', '路人甲', 'm20');
  await D.win.fill('#joinCode', code);
  await D.win.click('#btnJoin');
  await D.waitFor(() => window.__xkm.mode === 'net' && window.__xkm.view, null, 30000);
  const dv = await D.win.evaluate(() => ({ seat: window.__xkm.mySeat, hidden: window.__xkm.view.players.every((p) => p.hand === null) }));
  check('開始後加入的人成為觀眾、看不到任何手牌', dv.seat === -1 && dv.hidden, JSON.stringify(dv));

  // 打幾手
  const t0 = Date.now();
  let steps = 0, proxied = false;
  for (;;) {
    const over = await A.win.evaluate(() => !!(window.__xkm.view && window.__xkm.view.result));
    if (over) break;
    if (Date.now() - t0 > 240000) throw new Error('牌局打太久');
    for (const X of all) { const r = await autoStep(X); if (r !== 'idle' && r !== 'err') steps++; }
    if (!proxied && steps > 12) {
      await B.win.click('#btnProxy');
      await A.waitFor(() => window.__xkm.proxy[1]);
      proxied = true;
      check('來賓按軍師代打，房主端改由 AI 替他打', true);
      await B.win.screenshot({ path: path.join(outDir, 'n3-guest-proxy.png') });
    }
    await A.win.waitForTimeout(150);
  }
  // 一致性
  const results = await Promise.all([...all, D].map((X) => X.waitFor(() => window.__xkm.view && window.__xkm.view.result && JSON.stringify(window.__xkm.view.result.deltas), null, 15000)));
  check('四個畫面的結算結果一致', new Set(results).size === 1, results.join(' | '));
  const sum = JSON.parse(results[0]).reduce((a, b) => a + b, 0);
  check('輸贏加總為 0', sum === 0, String(sum));
  await B.waitFor(() => document.querySelector('.modal .result'), null, 15000);
  await B.win.screenshot({ path: path.join(outDir, 'n4-guest-result.png') });
  const recB = await B.win.evaluate(async () => (await window.xk.games.list()).length);
  const kbB = await B.win.evaluate(async () => ((await window.xk.kb.get()) || {}).hands || 0);
  check('來賓也收錄牌譜、學進智庫', recB >= 1 && kbB >= 1, `牌譜 ${recB}、智庫 ${kbB}`);

  // 斷線：C 離開，房主把 C 的座位改成 AI
  await C.app.close();
  await A.waitFor(() => window.__xkm.seats[2].kind === 'ai' || !window.__xkm.net.members.some((m) => m.seat === 2), null, 30000);
  check('有人離線時房主會知道', true);

  for (const X of [A, B, D]) check(`${X.name} 沒有錯誤訊息`, X.errors.length === 0, X.errors.slice(0, 4).join('\n'));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  for (const X of [...all, D].filter(Boolean)) { await X.win.screenshot({ path: path.join(outDir, `fail-${X.name}.png`) }).catch(() => {}); if (X.errors.length) console.log(X.name, X.errors.slice(0, 5).join('\n')); }
} finally {
  for (const X of [...all, D].filter(Boolean)) await X.app.close().catch(() => {});
  try { server.close ? server.close() : server._server?.close(); } catch {}
  console.log(`\n通過 ${pass}，失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
}

// 單機端對端測試：首頁、頭像、一人對三 AI 打完一局、吃碰按鈕、軍師（離線）、代打、智庫、重播、說明、AI 對戰
// 用法：node e2e/smoke.mjs [截圖資料夾]
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
fs.rmSync(path.join(appData, 'xiaoke-mahjong-e2eSmoke'), { recursive: true, force: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eSmoke', '--autoplay-policy=no-user-gesture-required'] });
const win = await app.firstWindow();
await win.setViewportSize({ width: Number(process.env.W || 1500), height: Number(process.env.H || 900) }).catch(() => {});
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await win.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 150));
  }
};
const shot = async (name) => { if (process.env.CAM) console.log(name, await win.evaluate(() => { const t = window.__xkmTable; return t ? [t.camera.position.length().toFixed(1), t.camera.fov, t.el.clientWidth, t.el.clientHeight].join(' ') : ''; })); return win.screenshot({ path: path.join(outDir, name + '.png') }); };

// 我方自動打牌：輪到打牌就用提示的那張（滑鼠邏輯：點兩下）；有吃碰就按「過」，能胡就胡
async function playMine(maxMs = 180000, opts = {}) {
  const t0 = Date.now();
  let discards = 0, passes = 0, wins = 0;
  for (;;) {
    const st = await win.evaluate(() => {
      const S = window.__xkm;
      return { over: !!(S.view && S.view.result), opts: S.opts.map((o) => o.type), proxy: S.proxy[S.mySeat] };
    });
    if (st.over) break;
    if (Date.now() - t0 > maxMs) throw new Error('打太久了');
    if (st.opts.includes('tsumo') || st.opts.includes('hu')) {
      await win.click('.act.win'); wins++;
    } else if (st.opts.includes('discard')) {
      await win.evaluate(() => {
        const S = window.__xkm;
        const me = S.view.players[S.mySeat];
        // 打剛摸的那張（或第一張），用點擊邏輯：選取 → 再點一次打出
        const id = me.drawn >= 0 ? me.drawn : me.hand[0];
        window.__xkmTable.onTileClick(id);
        window.__xkmTable.onTileClick(id);
      });
      discards++;
    } else if (st.opts.includes('pass')) {
      if (opts.claim && (st.opts.includes('pon') || st.opts.includes('chi'))) { await win.click('.act.meld'); opts.claimed = (opts.claimed || 0) + 1; }
      else { await win.click('.act.pass'); passes++; }
    }
    await win.waitForTimeout(120);
  }
  return { discards, passes, wins };
}

try {
  await win.waitForSelector('.pf-grid', { timeout: 20000 });
  check('第一次開啟要求選頭像與軍師', true);
  await shot('1-picker');
  // 選一位男性牌友與一位軍師
  await win.click('.pf-item[data-key="avatar"]');
  await win.click('.pf-tab[data-k="advisor"]');
  await win.click('.pf-item[data-key="advisor"]');
  await win.click('.modal .pf-ok');
  await win.waitForSelector('#startAI');
  await win.evaluate(async () => { window.__xkm.settings = await window.xk.settings.set({ music: { autoplay: false }, voiceCall: false }); });
  const home = await win.evaluate(() => ({ clock: document.querySelector('#homeClock').textContent, credit: document.querySelector('.credit').textContent, avatar: document.querySelector('.pc-avatar').src }));
  check('首頁顯示西元日期時間', /^西元 20\d\d 年/.test(home.clock), home.clock);
  check('首頁註明遊戲開發者', home.credit.includes('吳玉柱') && home.credit.includes('Claude AI Opus 5.5'), home.credit);
  check('首頁顯示我的頭像', /m\d\d\.svg$/.test(home.avatar), home.avatar);
  await shot('2-home');

  // ---------- A：一人對三 AI（打一局） ----------
  await win.selectOption('#lenAI', 'hand1');
  await win.click('#startAI');
  await waitFor(() => document.querySelector('.versus'));
  check('開局顯示對陣畫面', true);
  await shot('3-versus');
  await waitFor(() => window.__xkm.view && window.__xkm.hand);
  const g0 = await win.evaluate(() => {
    const S = window.__xkm;
    return { seats: S.seats.map((s) => s.kind), myCount: S.view.players[0].hand.length, cards: document.querySelectorAll('.seat-card').length, clock: document.querySelector('#clock').textContent, objs: window.__xkmTable.objs.size };
  });
  check('四家：我＋三位 AI', g0.seats.join() === 'me,ai,ai,ai', g0.seats.join());
  check('我拿到 16 或 17 張', [16, 17].includes(g0.myCount), String(g0.myCount));
  check('牌桌顯示四張座位卡', g0.cards === 4);
  check('對局上方顯示日期時間', g0.clock.startsWith('西元'), g0.clock);
  check('3D 牌桌有立體牌', g0.objs > 60, String(g0.objs));
  await win.waitForTimeout(1200);
  await shot('4-table');

  // 軍師（離線）
  await waitFor(() => window.__xkm.opts.some((o) => o.type === 'discard') || window.__xkm.view.result, null, 60000);
  await win.click('.adv-quick .chip');
  await waitFor(() => { const m = [...document.querySelectorAll('.adv-msg.ai')].pop(); return m && !m.classList.contains('thinking') && m.textContent.length > 8; });
  const adv = await win.evaluate(() => [...document.querySelectorAll('.adv-msg.ai')].pop().textContent);
  check('離線軍師給出建議', /建議|還沒輪到|結束/.test(adv), adv.slice(0, 80));
  await shot('5-advisor');

  // 提示
  const hintOk = await win.evaluate(() => { const b = document.querySelector('#btnHint'); if (b.disabled) return 'skip'; b.click(); return window.__xkmTable.marks.hint >= 0; });
  check('提示會標出建議打的牌', hintOk === true || hintOk === 'skip', String(hintOk));

  const r1 = await playMine();
  check('打完一局', true, JSON.stringify(r1));
  await waitFor(() => document.querySelector('.modal .result'), null, 15000);
  const res = await win.evaluate(() => document.querySelector('.modal').textContent);
  check('結算畫面有台數或流局', /台|流局/.test(res), res.slice(0, 120));
  await shot('6-result');
  await win.evaluate(() => document.querySelector('.modal-btns button.primary').click());
  await win.waitForTimeout(500);
  // 整場（一局）結束 → 最終排名
  const fin = await win.evaluate(() => (document.querySelector('.modal h3') || {}).textContent || '');
  check('一局制打完顯示最終排名', fin.includes('最終排名'), fin);
  await shot('7-final');
  await win.evaluate(() => [...document.querySelectorAll('.modal-btns button')].find((b) => b.textContent === '回首頁').click());
  await win.waitForSelector('#startAI');

  // ---------- 軍師代打 ----------
  await win.selectOption('#lenAI', 'round1');
  await win.click('#startAI');
  await waitFor(() => window.__xkm.hand && !document.querySelector('.versus'), null, 15000);
  await win.click('#btnProxy');
  const p1 = await win.evaluate(() => ({ on: window.__xkm.proxy[0], txt: document.querySelector('#btnProxy').textContent, tag: !!document.querySelector('.seat-card.pos0 .tag.proxy') }));
  check('按軍師代打後由軍師接手', p1.on && p1.txt.includes('換回真人') && p1.tag, JSON.stringify(p1));
  const before = await win.evaluate(() => window.__xkm.hand.p[0].discards);
  await waitFor((b) => window.__xkm.hand.result || window.__xkm.hand.p[0].discards > b, before, 30000);
  check('代打時軍師自己打牌', true);
  await shot('8-proxy');
  await win.click('#btnProxy');
  check('可以換回真人', await win.evaluate(() => !window.__xkm.proxy[0]));
  // 吃碰測試：這次遇到吃碰都接受，最多打完一局
  const o2 = { claim: true };
  await playMine(180000, o2);
  check('吃碰按鈕可用（或本局沒機會）', true, `吃碰 ${o2.claimed || 0} 次`);
  await waitFor(() => document.querySelector('.modal .result'), null, 15000);
  await win.evaluate(() => [...document.querySelectorAll('.modal-btns button')].find((b) => b.textContent === '看牌桌').click());
  await win.waitForTimeout(300);
  const next = await win.evaluate(() => !document.querySelector('#btnNext').classList.contains('hidden'));
  check('一局結束後可以按「下一局」', next);
  await shot('9-after-hand');
  await win.click('#btnNext');
  await waitFor(() => window.__xkm.handNo === 2 && window.__xkm.view && !window.__xkm.view.result);
  check('進入第二局', true);
  // 離開
  await win.click('#btnHome');
  await win.evaluate(() => [...document.querySelectorAll('.modal-btns button')].find((b) => b.textContent === '離開').click());
  await win.waitForSelector('#startAI');

  // ---------- 智庫與重播 ----------
  await win.click('#btnKB');
  await waitFor(() => document.querySelector('.kb-stats'));
  const kb = await win.evaluate(() => ({ learned: Number(document.querySelector('.kb-card b').textContent), rows: document.querySelectorAll('.rec-table tbody tr').length }));
  check('智庫已學習打過的牌局', kb.learned >= 2, JSON.stringify(kb));
  check('智庫列出牌譜', kb.rows >= 2, JSON.stringify(kb));
  await shot('10-kb');
  await win.evaluate(() => document.querySelector('.rec-table .ops button').click());
  await waitFor(() => window.__xkm.mode === 'replay');
  for (let i = 0; i < 12; i++) await win.click('#rpNext');
  const rp = await win.evaluate(() => ({ step: window.__xkm.replay.step, banner: document.querySelector('#turnBanner').textContent, open: window.__xkm.view.players.every((p) => p.hand) }));
  check('牌譜重播可以一步步前進', rp.step === 12 && rp.banner.includes('重播'), JSON.stringify(rp));
  check('重播時四家手牌公開', rp.open);
  await shot('11-replay');
  await win.click('#btnHome');
  await win.waitForSelector('#startAI');

  // ---------- 遊戲說明 ----------
  await win.click('#btnGuide');
  await waitFor(() => document.querySelector('.gd-tile'));
  const gd = await win.evaluate(() => ({ lessons: document.querySelectorAll('.gd-item').length, tiles: document.querySelectorAll('.gd-tile').length }));
  check('說明有 10 課＋練習題', gd.lessons === 11, String(gd.lessons));
  await win.click('.gd-item[data-i="8"]');
  const talk = await win.evaluate(() => document.querySelector('.gd-caption').textContent);
  check('台語口語單元', talk.includes('Tsia̍h') || talk.includes('tsia̍h'), talk.slice(0, 60));
  await shot('12-guide-talk');
  await win.click('#gdNext');
  await win.click('.gd-item[data-i="p"]');
  await win.click('.gd-tiles.pick .gd-tile');
  const pr = await win.evaluate(() => document.querySelector('.gd-result').textContent);
  check('練習題會判斷對錯', pr.length > 3, pr);
  await shot('13-guide-practice');
  await win.click('.gd-back');
  await win.waitForSelector('#startAivai');

  // ---------- C：全部 AI ----------
  await win.evaluate(() => document.querySelector('#startAivai').parentElement.querySelector('.segbtn[data-v="fast"]').click());
  await win.click('#startAivai');
  await waitFor(() => window.__xkm.mode === 'aivai' && window.__xkm.hand && window.__xkm.hand.p.some((p) => p.river.length >= 3), null, 30000);
  const av = await win.evaluate(() => ({ open: window.__xkm.view.players.every((p) => p.hand), banner: document.querySelector('#turnBanner').textContent }));
  check('AI 對戰四家手牌公開', av.open);
  check('AI 對戰進行中', av.banner.includes('AI 對戰'), av.banner);
  await win.waitForTimeout(800);
  await shot('14-aivai');
  await win.click('#btnPause');
  check('可以暫停', await win.evaluate(() => window.__xkm.paused));
  await win.click('#btnHome');
  await win.waitForSelector('#startAI');

  check('沒有錯誤訊息', errors.length === 0, errors.slice(0, 5).join('\n'));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await shot('fail').catch(() => {});
  if (errors.length) console.log(errors.slice(0, 8).join('\n'));
} finally {
  await app.close();
  console.log(`\n通過 ${pass}，失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
}

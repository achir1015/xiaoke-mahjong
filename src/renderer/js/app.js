// 小柯機器人台灣麻將遊戲：主控流程（一人對三 AI、遠端真人、AI 對 AI、軍師代打、麻將智庫、牌譜重播）
import { $, $$, h, toast, modal, sleep, errMsg, fmtDate, uid } from './util.js';
import { Match, Hand, MATCH_LENGTHS, replayHand, decodeAction } from './rules.js';
import { tileType, typeName, typeSpeech, faceUrl, WIND_NAMES, isFlowerType } from './tiles.js';
import { LEVELS, decide } from './ai.js';
import { KnowledgeBase } from './kb.js';
import { Table3D } from './table3d.js';
import { Room, PROTOCOL } from './net.js';
import { MusicPlayer } from './music.js';
import { AdvisorPanel, actionText } from './advisor-ui.js';
import { sfx, setSfx, setSfxVolume, sfxVolume } from './sfx.js';
import { voice } from './voice.js';
import { loadPortraits, portraitUrl, pickProfile, randomProfile, validProfile, labelOf } from './portraits.js';
import { openGuide } from './guide.js';

const APP_NAME = '小柯機器人台灣麻將遊戲';
const CREDIT = '遊戲開發：吳玉柱 先生 與 Claude AI Opus 5.5';
const SPEEDS = [['fast', '快', 350], ['normal', '一般', 800], ['slow', '慢', 1500]];
const TIMEOUT = { act: 30000, claim: 15000 };

const S = {
  settings: null, info: null, screen: 'home',
  mode: null,            // ai | net | aivai | replay
  match: null, hand: null, matchId: '',
  seats: [],             // [{ name, kind: me|ai|remote, level, profile, left }]
  mySeat: -1,
  proxy: [false, false, false, false],
  view: null, opts: [], scores: [0, 0, 0, 0], label: '', handNo: 0, matchOver: false,
  selected: -1, lastEv: 0, aiTimer: 0, paused: false, aivaiDelay: 800,
  deadlines: {},         // 座位 → 截止時間（遠端對戰）
  shownResult: '',
  kb: null,
  room: null, net: null,
  history: [],           // 來賓自己收集的每局紀錄
  voice: { on: false, mic: null, calls: new Map() },
  replay: null,
};

let table, music, advisor;
const newMatchId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + uid().slice(-6);
const myName = () => S.settings.playerName || '牌友';
const lvName = (i) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))].name;
const isAuthority = () => S.mode === 'ai' || S.mode === 'aivai' || (S.mode === 'net' && S.net && S.net.role === 'host');
const viewSeat = () => (S.mySeat >= 0 ? S.mySeat : 0);
const seatName = (s) => (S.seats[s] ? S.seats[s].name : WIND_NAMES[s]);

// ---------------- 啟動 ----------------
async function init() {
  S.settings = await xk.settings.get();
  S.info = await xk.sys.info();
  setSfx(S.settings.sfx);
  setSfxVolume(S.settings.sfxVolume ?? 0.8);
  voice.enabled = S.settings.voiceCall !== false;
  await loadPortraits();
  S.kb = new KnowledgeBase(await xk.kb.get());

  table = new Table3D($('#board'), { onTileClick });
  setView(S.settings.view || 'tilt', false);
  table.render(new Hand({ seed: 1, dealer: 0, roundWind: 0 }).view('all'), 0);

  music = new MusicPlayer($('#musicPanel'), S.settings, (patch) => saveSettings(patch));
  await music.load();
  if (S.settings.music.autoplay && S.settings.music.enabled !== false) {
    const start = () => { music.play(); document.removeEventListener('pointerdown', start); };
    document.addEventListener('pointerdown', start);
  }
  music.renderState();

  advisor = new AdvisorPanel($('#advisorPanel'), () => ({
    view: S.view, opts: S.opts, mySeat: S.mySeat, names: S.seats.map((s) => s.name), kb: S.kb,
    showHint: (t) => showHint(t),
  }));
  advisor.setHasKey(S.settings.advisor.hasKey);
  if (S.settings.profile) advisor.setAdvisor(S.settings.profile.advisor);

  bindUI();
  renderHome();
  showScreen('home');
  setInterval(tick, 500);
  tick();
  document.addEventListener('pointerdown', () => sfx.resume(), { once: true });
  window.__xkm = S; // 方便自動化測試
  window.__xkmTable = table;
  window.__xkmApi = { humanAct, startAIGame, startAIvAI, nextHand: () => authNextHand() };
  if (!validProfile(S.settings.profile)) await chooseProfile(true);
  if (S.settings.autoUpdate !== false && S.info.packaged && !S.info.profile) setTimeout(() => checkUpdate(false), 5000);
}

async function saveSettings(patch) {
  S.settings = await xk.settings.set(patch);
  return S.settings;
}

async function chooseProfile(required) {
  const pr = await pickProfile(S.settings.profile, { required });
  if (pr) { await saveSettings({ profile: pr }); advisor.setAdvisor(pr.advisor); renderHome(); }
}

// ---------------- 畫面切換 ----------------
function showScreen(name) {
  S.screen = name;
  setDrawer(false);
  $$('.screen').forEach((el) => el.classList.toggle('on', el.id === 'scr-' + name));
  if (name === 'game') setTimeout(() => table.resize(), 30);
  if (name === 'kb') renderKB();
}

function bindUI() {
  $('#btnHome').onclick = () => leaveGame();
  $('#viewTilt').onclick = () => setView('tilt');
  $('#viewTop').onclick = () => setView('top');
  $('#viewLow').onclick = () => setView('low');
  $('#btnHint').onclick = () => hint();
  $('#btnProxy').onclick = () => toggleProxy();
  $('#btnPause').onclick = () => togglePause();
  $('#btnNext').onclick = () => onNextClick();
  $('#miniMusic').onclick = () => { selectTab('music'); music.toggle(); };
  // 手機：右側面板變成抽屜
  $('#btnDrawer').onclick = () => setDrawer(!document.documentElement.classList.contains('drawer-open'));
  $('#drawerShade').onclick = () => setDrawer(false);
  window.__xkmBack = onBackKey;
  $('#btnSfx').onclick = () => { const on = !S.settings.sfx; setSfx(on); saveSettings({ sfx: on }); renderVolume(); };
  const mv = $('#musicVol');
  mv.oninput = () => { music.cfg.volume = mv.value / 100; music.applyVolume(); music.persist(); };
  const sv = $('#sfxVol');
  sv.oninput = () => { setSfxVolume(sv.value / 100); sfx.select(); clearTimeout(sv._t); sv._t = setTimeout(() => saveSettings({ sfxVolume: sfxVolume() }), 400); };
  renderVolume();
  $$('.tab').forEach((t) => { t.onclick = () => { t.classList.remove('ping'); selectTab(t.dataset.tab); }; });
  $('#chatSend').onclick = () => sendChat();
  $('#chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  $('#btnVoice').onclick = () => toggleVoice();
  $('#btnMute').onclick = () => toggleMute();
  $('#rpPrev').onclick = () => replayGo(S.replay.step - 1);
  $('#rpNext').onclick = () => replayGo(S.replay.step + 1);
  $('#rpPlay').onclick = () => replayAuto();
  $('#rpPrevHand').onclick = () => replayHandAt(S.replay.hi - 1);
  $('#rpNextHand').onclick = () => replayHandAt(S.replay.hi + 1);
  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (S.mode === 'replay') {
      if (e.key === 'ArrowLeft') replayGo(S.replay.step - 1);
      if (e.key === 'ArrowRight') replayGo(S.replay.step + 1);
    }
    if (e.key === 'Escape' && S.selected >= 0) { S.selected = -1; table.setSelected(-1); }
  });
  table.renderer.domElement.addEventListener('dblclick', () => {
    if (S.selected >= 0 && canDiscard()) discardTile(S.selected);
  });
}

function renderVolume() {
  $('#musicVol').value = Math.round((music ? music.cfg.volume : 0.45) * 100);
  $('#sfxVol').value = Math.round(sfxVolume() * 100);
  $('#btnSfx').textContent = S.settings.sfx ? '🔔' : '🔕';
}

function setDrawer(on) { document.documentElement.classList.toggle('drawer-open', !!on); }

// Android 返回鍵：先關對話框、抽屜，再離開牌桌；回傳 true 表示已處理
function onBackKey() {
  const back = [...document.querySelectorAll('.modal-back')].pop();
  if (back) { const btns = [...back.querySelectorAll('.modal-btns button')]; (btns.find((b) => !b.classList.contains('primary')) || btns[0])?.click(); return true; }
  if (document.documentElement.classList.contains('drawer-open')) { setDrawer(false); return true; }
  if (S.screen === 'guide') { document.querySelector('.gd-back')?.click(); return true; }
  if (S.screen === 'kb') { showScreen('home'); return true; }
  if (S.screen === 'game') { leaveGame(); return true; }
  return false;
}

function selectTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
}

function setView(v, save = true) {
  table.setView(v);
  $$('.viewbtn').forEach((b) => b.classList.toggle('on', b.id === 'view' + v[0].toUpperCase() + v.slice(1)));
  if (save) saveSettings({ view: v });
}

const WEEK = '日一二三四五六';
function tick() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const el = $('#clock');
  if (el) el.textContent = `西元 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（${WEEK[d.getDay()]}）${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const hc = $('#homeClock');
  if (hc) hc.textContent = el ? el.textContent : '';
  if (S.screen === 'game') { checkDeadlines(); renderTimers(); }
}

// ---------------- 首頁 ----------------
function seg(options, value, onPick) {
  const el = h('div', { class: 'seg' }, ...options.map(([v, l]) => h('button', { class: 'segbtn' + (String(v) === String(value) ? ' on' : ''), 'data-v': v, onclick: () => { $$('.segbtn', el).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); el.dataset.v = v; onPick && onPick(v); } }, l)));
  el.dataset.v = value;
  return el;
}
const lvSelect = (id, val) => h('select', { class: 'lv', id }, LEVELS.map((l, i) => h('option', { value: i, selected: i === val }, l.name)));
const lenSelect = (id, val) => h('select', { class: 'lv', id }, MATCH_LENGTHS.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));

function stakeRow(cfg) {
  const base = h('input', { type: 'number', min: 10, max: 10000, step: 10, value: cfg.base ?? 50, class: 'num-in' });
  const per = h('input', { type: 'number', min: 5, max: 5000, step: 5, value: cfg.perTai ?? 20, class: 'num-in' });
  const el = h('div', { class: 'stake' }, h('span', {}, '底'), base, h('span', {}, '台'), per);
  el.read = () => ({ base: Math.max(10, Number(base.value) || 50), perTai: Math.max(5, Number(per.value) || 20) });
  return el;
}

function renderHome() {
  const home = $('#homeBody');
  home.innerHTML = '';
  const pr = S.settings.profile || {};
  const mc = S.settings.match || {};
  const nameInput = h('input', { class: 'name-in', value: myName(), maxLength: 16, onchange: (e) => saveSettings({ playerName: e.target.value.trim() || '牌友' }) });

  // A：一人對三位 AI
  const lvA = lvSelect('lvAI', mc.level ?? 2);
  const lenA = lenSelect('lenAI', mc.length || 'round1');
  const stA = stakeRow(mc);
  const cardAI = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🤖'),
    h('h2', {}, 'A　一人對三位 AI'),
    h('p', { class: 'muted' }, '不需要網路。您坐在畫面下方，其他三家由小柯 AI 打；AI 軍師隨時在旁指點，也可以代打。'),
    h('label', {}, 'AI 難度：'), lvA,
    h('label', {}, '局數：'), lenA,
    h('label', {}, '計分（每家付「底＋台數×台」）：'), stA,
    h('button', { class: 'primary big', id: 'startAI', onclick: () => {
      const cfg = { level: Number(lvA.value), length: lenA.value, ...stA.read() };
      saveSettings({ match: cfg });
      startAIGame(cfg);
    } }, '開始打牌'));

  // B：遠端真人
  const nc = S.settings.netCfg || {};
  const lvB = lvSelect('lvNet', nc.aiLevel ?? 2);
  const lenB = lenSelect('lenNet', nc.length || 'round1');
  const codeIn = h('input', { class: 'code-in', id: 'joinCode', placeholder: '輸入 6 位數房號', maxLength: 7, inputMode: 'numeric' });
  const cardNet = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🌐'),
    h('h2', {}, 'B　邀約遠端真人'),
    h('p', { class: 'muted' }, '建立房間、把房號告訴朋友。最多四位真人，空位由 AI 補上；之後加入的人當觀眾。可以語音通話、文字聊天。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '空位 AI 難度：'), lvB), h('div', {}, h('label', {}, '局數：'), lenB)),
    h('button', { class: 'primary', id: 'btnHost', onclick: () => { const cfg = { aiLevel: Number(lvB.value), length: lenB.value, base: mc.base ?? 50, perTai: mc.perTai ?? 20 }; saveSettings({ netCfg: cfg }); hostRoom(cfg); } }, '建立房間（我當房主）'),
    h('div', { class: 'net-or' }, '或'),
    h('div', { class: 'net-row' }, codeIn, h('button', { class: 'primary', id: 'btnJoin', onclick: () => joinRoom(codeIn.value) }, '加入房間')),
    h('div', { id: 'netWait', class: 'net-wait hidden' }));

  // C：全部 AI
  const av = S.settings.aivai || {};
  const lvC = [0, 1, 2, 3].map((s) => lvSelect('aivai' + s, (av.levels || [])[s] ?? 2));
  const speedSel = seg(SPEEDS.map(([v, l]) => [v, l]), av.speed || 'normal');
  const lenC = lenSelect('lenAivai', av.length || 'round1');
  const cardAivai = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🎬'),
    h('h2', {}, 'C　全部 AI 對戰'),
    h('p', { class: 'muted' }, '坐下來觀戰，四家手牌全部攤開，看小柯 AI 怎麼打。可以暫停、請軍師講解，牌譜也會存進智庫。'),
    h('div', { class: 'lv-row4' }, ...lvC.map((sel, s) => h('div', {}, h('label', {}, `第 ${s + 1} 家：`), sel))),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '每步速度：'), speedSel), h('div', {}, h('label', {}, '局數：'), lenC)),
    h('button', { class: 'primary big', id: 'startAivai', onclick: () => {
      const cfg = { levels: lvC.map((x) => Number(x.value)), speed: speedSel.dataset.v, length: lenC.value, base: mc.base ?? 50, perTai: mc.perTai ?? 20 };
      saveSettings({ aivai: cfg });
      startAIvAI(cfg);
    } }, '開始觀戰'));

  const profileCard = h('div', { class: 'profile-card' },
    h('img', { class: 'pc-avatar', src: portraitUrl(pr.avatar), title: '我的頭像' }),
    h('div', { class: 'pc-mid' },
      h('label', {}, '我的暱稱'), nameInput,
      h('div', { class: 'pc-adv' }, h('img', { src: portraitUrl(pr.advisor) }), h('span', {}, `AI 軍師：${labelOf(pr.advisor) || '未選擇'}`)),
      h('button', { class: 'small', onclick: () => chooseProfile(false) }, '更換頭像與軍師')));

  home.append(
    h('div', { class: 'home-hero' },
      h('img', { class: 'hero-icon', src: '../../build/icon.png', alt: '' }),
      h('div', {}, h('h1', {}, APP_NAME), h('p', { class: 'muted' }, '3D 台灣 16 張麻將．AI 軍師．遠端連線＋語音．麻將智庫'), h('div', { id: 'homeClock', class: 'clock home-clock' })),
      profileCard),
    h('div', { class: 'mode-grid' }, cardAI, cardNet, cardAivai),
    h('div', { class: 'home-links' },
      h('button', { class: 'guide-btn', id: 'btnGuide', onclick: () => openGuide(guideCtx()) }, '📖 遊戲說明'),
      h('button', { id: 'btnKB', onclick: () => showScreen('kb') }, '📚 麻將智庫'),
      h('button', { onclick: () => openSettings() }, '⚙ 設定'),
      h('button', { onclick: () => { selectTab('music'); enterIdle(); setDrawer(true); } }, '♫ 背景音樂'),
      h('button', { id: 'btnAbout', onclick: () => openAbout() }, 'ℹ 關於與更新')),
    h('div', { class: 'credit muted small' }, `v${S.info.version}　${CREDIT}`),
  );
  tick();
}

function guideCtx() {
  return { voice, back: () => { renderHome(); showScreen('home'); }, show: () => showScreen('guide') };
}

function enterIdle() {
  if (!S.mode) {
    document.body.className = 'mode-idle';
    S.view = null;
    $('#turnBanner').textContent = '請回首頁選擇模式';
    $('#seats').innerHTML = '';
    $('#actionBar').innerHTML = '';
  }
  showScreen('game');
}

// ---------------- 開局 ----------------
function aiSeat(level, used) {
  const pr = randomProfile(used);
  used.push(pr.avatar, pr.advisor);
  return { name: `${labelOf(pr.avatar)}（AI）`, kind: 'ai', level, profile: pr };
}

function myProfile() { return S.settings.profile || randomProfile(); }

function setupMatch(mode, cfg, seats, mySeat, matchId) {
  stopTimers();
  S.mode = mode;
  S.seats = seats;
  S.mySeat = mySeat;
  S.proxy = [false, false, false, false];
  S.paused = false;
  S.history = [];
  S.matchId = matchId || newMatchId();
  S.cfg = cfg;
  S.matchOver = false;
  S.shownResult = '';
  document.body.className = 'mode-' + mode;
  table.showAll = mode === 'aivai';
  $('#eventLog').innerHTML = '';
  if (mode !== 'net') { $('#chatLog').innerHTML = ''; $('#memberList').innerHTML = ''; }
  advisor.reset();
  showScreen('game');
  selectTab(mode === 'net' ? 'chat' : 'advisor');
}

function startAIGame(cfg) {
  const used = [S.settings.profile?.avatar, S.settings.profile?.advisor].filter(Boolean);
  const seats = [0, 1, 2, 3].map((s) => (s === 0 ? { name: myName(), kind: 'me', profile: myProfile() } : aiSeat(cfg.level ?? 2, used)));
  S.lastCfg = cfg;
  setupMatch('ai', cfg, seats, 0);
  S.match = new Match({ length: cfg.length, base: cfg.base, perTai: cfg.perTai });
  versus().then(() => authNextHand());
}

function startAIvAI(cfg) {
  cfg = cfg || { levels: [2, 2, 2, 2], speed: 'normal', length: 'round1' };
  S.lastAivai = cfg;
  const used = [];
  const seats = [0, 1, 2, 3].map((s) => aiSeat(cfg.levels[s] ?? 2, used));
  setupMatch('aivai', cfg, seats, -1);
  S.aivaiDelay = (SPEEDS.find(([v]) => v === cfg.speed) || SPEEDS[1])[2];
  S.match = new Match({ length: cfg.length, base: cfg.base, perTai: cfg.perTai });
  authNextHand();
}

// 開局的對陣畫面
async function versus() {
  const el = h('div', { class: 'versus' }, h('h2', {}, '牌桌就位'),
    h('div', { class: 'vs-row' }, S.seats.map((st, s) => h('div', { class: 'vs-seat' + (s === S.mySeat ? ' me' : '') },
      h('img', { src: portraitUrl(st.profile?.avatar) }), h('b', {}, st.name),
      h('span', { class: 'muted small' }, st.kind === 'ai' ? `AI ${lvName(st.level ?? 2)}` : st.kind === 'me' ? '我' : '遠端真人'),
      h('span', { class: 'vs-adv' }, h('img', { src: portraitUrl(st.profile?.advisor) }), `軍師 ${labelOf(st.profile?.advisor)}`)))));
  $('#boardWrap').append(el);
  sfx.shuffle();
  await sleep(2200);
  el.remove();
}

// ---------------- 牌局（持有完整狀態的一方） ----------------
function authNextHand() {
  if (!S.match || S.match.over) return;
  stopTimers();
  S.hand = S.match.nextHand();
  S.handNo = S.match.handNo;
  S.lastEv = 0;
  S.selected = -1;
  S.deadlines = {};
  S.shownResult = '';
  $('#btnNext').classList.add('hidden');
  advisor.reset();
  for (const m of (S.net && S.net.members) || []) m.lastEv = 0;
  logLine(`── 第 ${S.handNo} 局：${S.match.label()}，莊家 ${seatName(S.hand.dealer)} ──`, 'sys');
  authRefresh();
}

function aiControlled(s) {
  const st = S.seats[s];
  return !!st && (st.kind === 'ai' || S.proxy[s]);
}

function authRefresh() {
  const hd = S.hand;
  if (!hd) return;
  S.scores = S.match.scores.slice();
  S.label = S.match.label();
  // 自己的畫面
  S.view = hd.view(S.mode === 'aivai' ? 'all' : S.mySeat);
  S.opts = S.mySeat >= 0 ? hd.options(S.mySeat) : [];
  const evs = hd.events.slice(S.lastEv);
  S.lastEv = hd.events.length;
  handleEvents(evs);
  // 遠端：各自的畫面
  if (S.mode === 'net') pushStates();
  if (hd.result) { onHandOver(); }
  else schedule();
  renderAll();
}

function metaInfo() {
  return {
    scores: S.scores, label: S.label, handNo: S.handNo, matchOver: S.matchOver, matchId: S.matchId, cfg: S.cfg,
    seats: S.seats.map((st) => ({ name: st.name, kind: st.kind === 'me' ? 'human' : st.kind === 'remote' ? 'human' : 'ai', level: st.level, profile: st.profile, left: !!st.left })),
    proxy: S.proxy, deadlines: Object.fromEntries(Object.entries(S.deadlines).map(([s, t]) => [s, Math.max(0, t - Date.now())])),
  };
}

function pushStates(only) {
  if (!S.net || S.net.role !== 'host' || !S.hand) return;
  const meta = metaInfo();
  for (const m of S.net.members) {
    if (m.id === S.room.myId) continue;
    if (only && m.id !== only) continue;
    const seat = m.seat;
    const ev = S.hand.events.slice(m.lastEv || 0);
    m.lastEv = S.hand.events.length;
    S.room.sendTo(m.id, { t: 'state', view: S.hand.view(seat >= 0 ? seat : -1), opts: seat >= 0 ? S.hand.options(seat) : [], ev, meta });
  }
}

// 安排 AI（或代打）行動；遠端真人設定時限
function schedule() {
  const hd = S.hand;
  clearTimeout(S.aiTimer);
  if (!hd || hd.result) return;
  if (S.mode === 'aivai' && S.paused) return;
  const waiting = [0, 1, 2, 3].filter((s) => hd.options(s).length);
  // 時限（只有遠端對戰）
  if (S.mode === 'net') {
    for (const s of waiting) if (!aiControlled(s) && !S.deadlines[s]) S.deadlines[s] = Date.now() + (hd.phase === 'act' ? TIMEOUT.act : TIMEOUT.claim);
    for (const s of Object.keys(S.deadlines)) if (!waiting.includes(Number(s))) delete S.deadlines[s];
  }
  const ai = waiting.find((s) => aiControlled(s));
  if (ai == null) return;
  const isClaim = hd.phase !== 'act';
  const delay = S.mode === 'aivai' ? (isClaim ? S.aivaiDelay * 0.5 : S.aivaiDelay) : isClaim ? 450 : 750;
  const handRef = hd, n = hd.events.length;
  S.aiTimer = setTimeout(() => {
    if (S.hand !== handRef || handRef.result || handRef.events.length !== n && !handRef.options(ai).length) { schedule(); return; }
    if (!aiControlled(ai) || !handRef.options(ai).length) { schedule(); return; }
    const level = S.proxy[ai] ? 3 : S.seats[ai].level ?? 2;
    const a = decide(handRef.view(ai), ai, handRef.options(ai), level, S.kb);
    try { handRef.act(ai, a); } catch (e) { console.warn('AI 行動失敗', e, a); handRef.act(ai, handRef.options(ai).find((o) => o.type === 'pass') || handRef.options(ai)[0]); }
    authRefresh();
  }, delay);
}

function checkDeadlines() {
  if (!isAuthority() || S.mode !== 'net' || !S.hand || S.hand.result) return;
  const now = Date.now();
  for (const [k, t] of Object.entries(S.deadlines)) {
    const s = Number(k);
    if (now < t || !S.hand.options(s).length) continue;
    delete S.deadlines[s];
    const opts = S.hand.options(s);
    // 逾時：打牌交給 AI，吃碰就當作「過」（可以胡還是會胡）
    let a = decide(S.hand.view(s), s, opts, 2, S.kb);
    if (S.hand.phase !== 'act' && a.type !== 'hu') a = opts.find((o) => o.type === 'pass') || a;
    chatSys(`${seatName(s)} 超過時間，系統代為${actionText(a)}`);
    S.hand.act(s, a);
    authRefresh();
    return;
  }
}

function humanAct(seat, a) {
  if (!S.hand || S.hand.result) return false;
  try { S.hand.act(seat, a); } catch (e) { toast(errMsg(e), 'err', 1600); return false; }
  delete S.deadlines[seat];
  authRefresh();
  return true;
}

function stopTimers() { clearTimeout(S.aiTimer); S.deadlines = {}; }

// 本地玩家的動作（房主直接執行；來賓送給房主）
function myAct(a) {
  S.selected = -1;
  table.setSelected(-1);
  table.setHint(-1);
  if (isAuthority()) { humanAct(S.mySeat, a); return; }
  if (S.mode === 'net' && S.room) {
    S.room.send({ t: 'act', a });
    S.opts = [];
    renderActions();
  }
}

// ---------------- 一局結束 ----------------
function onHandOver() {
  const hd = S.hand;
  if (!hd.settled) {
    S.match.endHand();
    S.scores = S.match.scores.slice();
    S.matchOver = S.match.over;
    const last = S.match.history[S.match.history.length - 1];
    // 存進智庫
    const meta = { seed: last.seed, dealer: last.dealer, roundWind: last.roundWind, streak: last.streak, base: S.match.cfg.base, perTai: S.match.cfg.perTai };
    if (S.kb.learnHand(meta, last.log, `${S.matchId}#${last.no}`)) saveKB();
    saveRecord(S.match.history);
    if (S.mode === 'net') { S.room.send({ t: 'handlog', entry: last, meta: metaInfo() }); pushStates(); }
  }
  showHandResult(S.view, metaInfo());
  if (S.mode === 'aivai' && !S.matchOver) S.aiTimer = setTimeout(() => { $$('.modal-back').forEach((b) => b.remove()); authNextHand(); }, 6000);
}

function recordBase() {
  return {
    id: S.matchId, date: new Date().toISOString(), mode: S.mode,
    names: S.seats.map((s) => s.name), kinds: S.seats.map((s) => s.kind), profiles: S.seats.map((s) => s.profile),
    mySeat: S.mySeat, cfg: { length: S.cfg?.length, base: S.match ? S.match.cfg.base : S.cfg?.base, perTai: S.match ? S.match.cfg.perTai : S.cfg?.perTai },
  };
}

async function saveRecord(history) {
  if (!history.length) return;
  try {
    await xk.games.save({ ...recordBase(), scores: S.scores.slice(), history, finished: S.matchOver });
  } catch (e) { toast('牌譜儲存失敗：' + errMsg(e), 'err'); }
}

let kbTimer = 0;
function saveKB() {
  clearTimeout(kbTimer);
  kbTimer = setTimeout(() => xk.kb.set(S.kb.toJSON()).catch(() => {}), 800);
}

function tilesRow(ids, cls = '') {
  return h('div', { class: 'tiles ' + cls }, ids.map((id) => (id < 0 ? h('span', { class: 'mt back' }) : h('img', { class: 'mt', src: faceUrl(tileType(id)), alt: typeName(tileType(id)) }))));
}

async function showHandResult(view, meta) {
  const key = `${meta.matchId}#${meta.handNo}`;
  if (S.shownResult === key || !view || !view.result) return;
  S.shownResult = key;
  const r = view.result;
  const names = meta.seats.map((s) => s.name);
  const me = S.mySeat;
  let title, cls;
  if (r.type === 'draw') { title = '流局（荒莊）'; cls = 'draw'; sfx.draw0(); }
  else {
    const who = names[r.winner];
    title = r.flowerWin ? `${who} ${r.flowerWin === 'baxian' ? '八仙過海' : '七搶一'}！` : r.selfDraw ? `${who} 自摸！` : `${who} 胡牌（${names[r.from]} 放槍）`;
    cls = 'win';
    if (me < 0 || r.winner === me) sfx.win(); else sfx.lose();
  }
  if (S.mode === 'net') chatSys(title);
  logLine(title, 'res');
  const body = h('div', { class: 'result' });
  if (r.type === 'win') {
    const pl = view.players[r.winner];
    body.append(
      h('div', { class: 'res-hand' },
        pl.hand ? tilesRow(pl.hand.filter((id) => id !== pl.drawn)) : null,
        pl.drawn >= 0 ? h('div', { class: 'res-win' }, h('span', {}, r.selfDraw ? '自摸' : '胡'), tilesRow([pl.drawn], 'big')) : null,
        ...pl.melds.map((m) => tilesRow(m.tiles, 'meld')),
        pl.flowers.length ? tilesRow(pl.flowers, 'flowers') : null),
      h('table', { class: 'tai-table' },
        h('tbody', {}, ...r.score.items.map((it) => h('tr', {}, h('td', {}, it.name), h('td', { class: 'n' }, `${it.tai} 台`))),
          !r.score.items.length ? h('tr', {}, h('td', {}, '屁胡（沒有台）'), h('td', { class: 'n' }, '0 台')) : null,
          h('tr', { class: 'sum' }, h('td', {}, '合計'), h('td', { class: 'n' }, `${r.score.total} 台`)))),
      h('div', { class: 'pay-lines muted small' }, ...r.lines.map((l) => h('div', {}, `${names[l.payer]} 付 ${l.amount}（${l.tai} 台${l.extra ? `，含莊家／連莊 ${l.extra} 台` : ''}）`))));
  } else body.append(h('p', {}, '牌摸完了沒有人胡牌，莊家連莊。'));
  body.append(h('table', { class: 'delta-table' }, h('tbody', {}, ...[0, 1, 2, 3].map((s) => h('tr', { class: s === me ? 'me' : '' },
    h('td', {}, h('img', { class: 'mini-av', src: portraitUrl(meta.seats[s].profile?.avatar) })), h('td', {}, names[s]),
    h('td', { class: 'n ' + (r.deltas[s] > 0 ? 'up' : r.deltas[s] < 0 ? 'down' : '') }, r.deltas[s] > 0 ? `+${r.deltas[s]}` : String(r.deltas[s])),
    h('td', { class: 'n' }, String(meta.scores[s])))))));
  const isHostish = isAuthority() && S.mode !== 'aivai';
  if (meta.matchOver) body.append(h('p', { class: 'res-final' }, '🏁 整場結束！'));
  const btns = [{ label: '看牌桌', value: 'stay' }];
  if (isHostish && !meta.matchOver) btns.push({ label: '下一局 ▶', value: 'next', primary: true });
  else if (meta.matchOver) btns.push({ label: '最終排名', value: 'final', primary: true });
  else btns.push({ label: '知道了', value: 'stay', primary: true });
  $('#btnNext').classList.toggle('hidden', !(isHostish && !meta.matchOver));
  $('#btnNext').textContent = '下一局 ▶';
  renderAll();
  await sleep(900);
  if (S.shownResult !== key) return;
  const v = await modal(title, body, btns);
  if (v === 'next') onNextClick();
  else if (v === 'final') showFinal(meta);
}

async function showFinal(meta) {
  const order = [0, 1, 2, 3].sort((a, b) => meta.scores[b] - meta.scores[a]);
  const start = (S.match && S.match.cfg.start) || 2000;
  const body = h('div', { class: 'final' }, ...order.map((s, i) => h('div', { class: 'final-row' + (s === S.mySeat ? ' me' : '') },
    h('span', { class: 'rank' }, ['🥇', '🥈', '🥉', '4'][i]), h('img', { src: portraitUrl(meta.seats[s].profile?.avatar) }),
    h('b', {}, meta.seats[s].name), h('span', { class: meta.scores[s] >= start ? 'up' : 'down' }, `${meta.scores[s]}（${meta.scores[s] - start >= 0 ? '+' : ''}${meta.scores[s] - start}）`))),
  h('p', { class: 'muted small' }, '本場牌譜已存進「麻將智庫」，可以重播檢討。'));
  if (S.mySeat >= 0 && order[0] === S.mySeat) sfx.win();
  const btns = S.mode === 'net' && S.net.role !== 'host' ? [{ label: '知道了', value: false, primary: true }] : [{ label: '回首頁', value: 'home' }, { label: '再來一場', value: 'again', primary: true }];
  const v = await modal('最終排名', body, btns);
  if (v === 'again') newMatchSameMode();
  else if (v === 'home') leaveGame(true);
}

function onNextClick() {
  $('#btnNext').classList.add('hidden');
  if (!isAuthority()) return;
  if (S.matchOver) { showFinal(metaInfo()); return; }
  authNextHand();
}

function newMatchSameMode() {
  if (S.mode === 'ai') startAIGame(S.lastCfg);
  else if (S.mode === 'aivai') startAIvAI(S.lastAivai);
  else if (S.mode === 'net' && S.net && S.net.role === 'host') hostStartGame();
}

// ---------------- 事件：音效、語音、紀錄 ----------------
function handleEvents(evs) {
  const names = S.seats.map((s) => s.name);
  for (const e of evs) {
    const who = names[e.seat] || '';
    switch (e.e) {
      case 'deal': sfx.shuffle(); break;
      case 'draw': if (e.seat === S.mySeat) sfx.draw(); break;
      case 'flower':
        if (!e.initial) { sfx.flower(); voice.call('補花'); }
        logLine(`${who} 補花 ${typeName(tileType(e.tile))}`);
        break;
      case 'discard':
        sfx.discard();
        voice.call(typeSpeech(tileType(e.tile)));
        logLine(`${who} 打 ${typeName(tileType(e.tile))}`, 'd' + e.seat);
        break;
      case 'chi': case 'pon': case 'kan': case 'ankan': case 'kakan': {
        const word = { chi: '吃', pon: '碰', kan: '槓', ankan: '槓', kakan: '槓' }[e.e];
        sfx.meld(); voice.call(word, { urgent: true, pitch: 1.1 });
        callout(e.seat, word);
        logLine(`${who} ${word}${e.t != null ? ' ' + typeName(e.t) : ''}`, 'call');
        break;
      }
      case 'rob-flower': voice.call('七搶一', { urgent: true }); callout(e.seat, '七搶一'); break;
      case 'win':
        voice.call(e.flowerWin ? (e.flowerWin === 'baxian' ? '八仙過海' : '七搶一') : e.selfDraw ? '自摸' : '胡', { urgent: true, pitch: 1.15 });
        callout(e.seat, e.flowerWin ? (e.flowerWin === 'baxian' ? '八仙過海' : '七搶一') : e.selfDraw ? '自摸' : '胡');
        break;
      case 'exhaust': voice.call('流局'); break;
      case 'turn':
        if (e.seat === S.mySeat && !S.proxy[S.mySeat] && S.mode !== 'aivai') { sfx.turn(); if (S.mode === 'net') xk.win.attention('輪到您打牌', ''); }
        break;
      case 'claim-open':
        if (S.mySeat >= 0 && (e.seats || []).includes(S.mySeat) && !S.proxy[S.mySeat]) sfx.turn();
        break;
    }
  }
}

function callout(seat, text) {
  const k = (seat - viewSeat() + 4) % 4;
  const el = h('div', { class: `callout pos${k}` }, text);
  $('#boardWrap').append(el);
  setTimeout(() => el.remove(), 1500);
}

function logLine(text, cls = '') {
  const box = $('#eventLog');
  box.append(h('div', { class: 'ev ' + cls }, text));
  while (box.children.length > 400) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

// ---------------- 畫面 ----------------
function renderAll() {
  const v = S.view;
  if (!v) return;
  table.setInteractive(canDiscard());
  table.render(v, S.mode === 'aivai' || S.mode === 'replay' ? -1 : S.mySeat);
  renderSeats();
  renderActions();
  renderBanner();
  renderScores();
  renderWaits();
  const playing = (S.mode === 'ai' || S.mode === 'net') && S.mySeat >= 0;
  $('#btnHint').disabled = !playing || !canDiscard();
  $('#btnProxy').disabled = !playing;
  $('#btnProxy').textContent = S.proxy[S.mySeat] ? '🙋 換回真人' : '🧙 軍師代打';
  $('#btnProxy').classList.toggle('on', !!S.proxy[S.mySeat]);
  $('#btnPause').textContent = S.paused ? '▶ 繼續' : '⏸ 暫停';
  $('#handLabel').textContent = S.label ? `第 ${S.handNo} 局．${S.label}` : '';
}

function canDiscard() {
  return S.mySeat >= 0 && !S.proxy[S.mySeat] && S.opts.some((o) => o.type === 'discard') && ['ai', 'net'].includes(S.mode);
}

function renderSeats() {
  const box = $('#seats');
  box.innerHTML = '';
  const v = S.view;
  for (let s = 0; s < 4; s++) {
    const st = S.seats[s] || {};
    const k = (s - viewSeat() + 4) % 4;
    const pl = v.players[s];
    const active = !v.result && (v.phase === 'act' ? v.turn === s : v.claim && v.claim.waiting.includes(s));
    const tags = [];
    if (s === v.dealer) tags.push(h('span', { class: 'tag dealer' }, v.streak ? `莊 連${v.streak}` : '莊'));
    tags.push(h('span', { class: 'tag wind' }, WIND_NAMES[pl.seatWind]));
    if (st.kind === 'ai') tags.push(h('span', { class: 'tag' }, st.left ? '離線．AI 代打' : `AI ${lvName(st.level ?? 2)}`));
    if (st.kind === 'remote') tags.push(h('span', { class: 'tag remote' }, '遠端'));
    if (S.proxy[s]) tags.push(h('span', { class: 'tag proxy' }, '軍師代打'));
    const card = h('div', { class: `seat-card pos${k}` + (active ? ' active' : '') + (s === S.mySeat ? ' me' : '') },
      h('div', { class: 'sc-av' }, h('img', { src: portraitUrl(S.proxy[s] ? st.profile?.advisor : st.profile?.avatar) }),
        S.proxy[s] ? h('img', { class: 'sc-sub', src: portraitUrl(st.profile?.avatar) }) : h('img', { class: 'sc-sub', src: portraitUrl(st.profile?.advisor), title: '軍師 ' + labelOf(st.profile?.advisor) })),
      h('div', { class: 'sc-info' },
        h('div', { class: 'sc-name' }, st.name || WIND_NAMES[s], s === S.mySeat ? h('span', { class: 'muted' }, '（我）') : null),
        h('div', { class: 'sc-tags' }, tags),
        h('div', { class: 'sc-score' }, `${S.scores[s] ?? 0}`, pl.flowers.length ? h('span', { class: 'sc-fl' }, `花 ${pl.flowers.length}`) : null),
        h('div', { class: 'sc-timer', 'data-seat': s })));
    box.append(card);
  }
  renderTimers();
}

function renderTimers() {
  const dl = isAuthority() ? S.deadlines : S.guestDeadlines || {};
  $$('.sc-timer').forEach((el) => {
    const s = el.dataset.seat;
    const t = dl[s];
    if (!t) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((t - Date.now()) / 1000));
    el.textContent = `⏱ ${left} 秒`;
    el.classList.toggle('urgent', left <= 5);
  });
}

function renderBanner() {
  const v = S.view;
  const b = $('#turnBanner');
  let text = '', cls = '';
  const myClaim = S.opts.some((o) => ['hu', 'pon', 'chi', 'kan'].includes(o.type));
  if (S.mode === 'replay') { text = `牌譜重播　第 ${S.replay.hi + 1} 局．第 ${S.replay.step} / ${S.replay.log.length} 步`; cls = 'replay'; }
  else if (v.result) { text = v.result.type === 'draw' ? '流局' : `${seatName(v.result.winner)} ${v.result.selfDraw ? '自摸' : '胡牌'}！`; cls = 'over'; }
  else if (S.mode === 'net' && S.net && S.net.status) { text = S.net.status; cls = 'watch'; }
  else if (S.mode === 'aivai') { text = S.paused ? 'AI 對戰．已暫停' : `AI 對戰．輪到 ${seatName(v.turn)}`; cls = 'watch'; }
  else if (S.proxy[S.mySeat]) { text = `軍師代打中（${labelOf(S.seats[S.mySeat]?.profile?.advisor)}）`; cls = 'watch'; }
  else if (myClaim) { text = `${seatName(v.claim.from)} 打出 ${typeName(tileType(v.claim.tile))}，要吃碰嗎？`; cls = 'mine'; }
  else if (canDiscard()) { text = '輪到您打牌'; cls = 'mine'; }
  else if (S.mySeat < 0) { text = `觀戰中．輪到 ${seatName(v.turn)}`; cls = 'watch'; }
  else { text = `換您觀牌（${seatName(v.turn)} 思考中…）`; cls = 'watch'; }
  b.textContent = text;
  b.className = 'turn-banner ' + cls;
}

function renderScores() {
  const box = $('#scoreBox');
  box.innerHTML = '';
  box.append(h('div', { class: 'muted small' }, S.label ? `第 ${S.handNo} 局．${S.label}` : ''),
    ...[0, 1, 2, 3].map((s) => h('div', { class: 'score-row' + (s === S.mySeat ? ' me' : '') }, h('img', { src: portraitUrl(S.seats[s]?.profile?.avatar) }), h('span', {}, seatName(s)), h('b', {}, String(S.scores[s] ?? 0)))));
}

// 聽牌提示：我聽哪些牌、各剩幾張
function renderWaits() {
  const el = $('#waitInfo');
  const v = S.view;
  if (S.mySeat < 0 || !v || v.result || !v.players[S.mySeat].hand) { el.classList.add('hidden'); return; }
  const me = v.players[S.mySeat];
  if (me.hand.length % 3 !== 1) { el.classList.add('hidden'); return; }
  import('./hand.js').then(({ countsOf, waits, shanten }) => {
    const c = countsOf(me.hand.map(tileType));
    const need = 5 - me.melds.length;
    const sh = shanten(c, need);
    el.innerHTML = '';
    if (sh > 0) { el.append(h('span', { class: 'muted' }, `還差 ${sh} 步聽牌`)); el.classList.remove('hidden'); return; }
    const seen = new Array(34).fill(0);
    for (const pl of v.players) { for (const id of pl.river) seen[tileType(id)]++; for (const m of pl.melds) for (const id of m.tiles) if (id >= 0) seen[tileType(id)]++; }
    for (const id of me.hand) seen[tileType(id)]++;
    const ws = waits(c, need);
    el.append(h('b', {}, '聽牌：'), ...ws.map((t) => h('span', { class: 'w' }, h('img', { src: faceUrl(t) }), `${Math.max(0, 4 - seen[t])}`)));
    el.classList.remove('hidden');
  });
}

function renderActions() {
  const bar = $('#actionBar');
  bar.innerHTML = '';
  if (S.mySeat < 0 || S.proxy[S.mySeat] || !['ai', 'net'].includes(S.mode)) return;
  const opts = S.opts;
  const btn = (label, a, cls = '') => h('button', { class: 'act ' + cls, onclick: () => myAct(a) }, label);
  for (const o of opts) {
    if (o.type === 'tsumo') bar.append(btn('自摸', o, 'win'));
    if (o.type === 'hu') bar.append(btn('胡', o, 'win'));
    if (o.type === 'pon') bar.append(btn('碰', o, 'meld'));
    if (o.type === 'kan') bar.append(btn('槓', o, 'meld'));
    if (o.type === 'ankan') bar.append(btn(h('span', {}, '暗槓 ', h('img', { class: 'mini-t', src: faceUrl(o.t) })), o, 'meld'));
    if (o.type === 'kakan') bar.append(btn(h('span', {}, '加槓 ', h('img', { class: 'mini-t', src: faceUrl(o.t) })), o, 'meld'));
    if (o.type === 'chi') {
      const t = tileType(S.view.claim.tile);
      const set = [...o.use, t].sort((a, b) => a - b);
      bar.append(btn(h('span', {}, '吃 ', ...set.map((x) => h('img', { class: 'mini-t' + (x === t ? ' claimed' : ''), src: faceUrl(x) }))), o, 'meld'));
    }
  }
  if (opts.some((o) => o.type === 'pass')) bar.append(btn('過', { type: 'pass' }, 'pass'));
}

// ---------------- 點牌、打牌 ----------------
function onTileClick(id) {
  if (!canDiscard()) {
    if (S.mySeat >= 0 && ['ai', 'net'].includes(S.mode) && !S.view?.result) { flashBanner(); sfx.illegal(); }
    return;
  }
  const mine = S.view.players[S.mySeat].hand || [];
  if (!mine.includes(id)) return;
  if (S.selected === id) { discardTile(id); return; }
  S.selected = id;
  table.setSelected(id);
  sfx.select();
}

function discardTile(id) {
  const t = tileType(id);
  if (isFlowerType(t)) return;
  myAct({ type: 'discard', t });
}

function flashBanner() {
  const b = $('#turnBanner');
  b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
}

function hint() {
  if (!canDiscard()) return;
  const a = decide(S.view, S.mySeat, S.opts, 3, S.kb);
  if (a.type === 'discard') { showHint(a.t); toast(`提示：打 ${typeName(a.t)}`, 'ok'); }
  else toast(`提示：${actionText(a)}`, 'ok');
}

function showHint(t) {
  table.setHint(t);
  clearTimeout(S.hintTimer);
  S.hintTimer = setTimeout(() => table.setHint(-1), 12000);
}

// ---------------- 軍師代打 ----------------
function toggleProxy() {
  if (S.mySeat < 0 || !['ai', 'net'].includes(S.mode)) return;
  const on = !S.proxy[S.mySeat];
  const adv = labelOf(S.seats[S.mySeat]?.profile?.advisor);
  if (S.mode === 'net' && S.net.role !== 'host') {
    S.room.send({ t: 'proxy', on });
    S.proxy[S.mySeat] = on;
  } else {
    S.proxy[S.mySeat] = on;
    if (S.mode === 'net') chatSys(`${myName()} ${on ? `請軍師 ${adv} 代打` : '換回真人'}`);
  }
  toast(on ? `軍師 ${adv} 接手代打，按「換回真人」隨時拿回來` : '換回真人，請繼續打牌', 'ok');
  if (on) voice.call(`${adv}來幫您打`);
  if (isAuthority()) authRefresh(); else renderAll();
}

function togglePause() {
  if (S.mode !== 'aivai') return;
  S.paused = !S.paused;
  if (!S.paused) schedule(); else clearTimeout(S.aiTimer);
  renderAll();
}

// ---------------- 離開 ----------------
async function leaveGame(force = false) {
  const active = (S.mode === 'ai' || S.mode === 'net') && S.view && !S.matchOver;
  if (active && !force) {
    const msg = S.mode === 'net' ? (S.net && S.net.role === 'host' ? '您是房主，離開後房間會關閉，確定要離開嗎？' : '確定要離開這個房間嗎？') : '這場還沒打完，確定要離開嗎？（已打完的局會保留在智庫）';
    const ok = await modal('離開牌桌', msg, [{ label: '留下', value: false }, { label: '離開', value: true, primary: true }]);
    if (!ok) return;
  }
  stopTimers();
  stopReplayAuto();
  closeNet();
  $$('.modal-back').forEach((b) => b.remove());
  S.mode = null; S.hand = null; S.match = null; S.view = null; S.opts = [];
  document.body.className = '';
  renderHome();
  showScreen('home');
}

// ---------------- 遠端對戰 ----------------
function netWait(content) {
  const w = $('#netWait');
  if (!w) return;
  w.classList.toggle('hidden', !content);
  w.innerHTML = '';
  if (content) w.append(content);
}
function memberOfSeat(s) { return S.net.members.find((m) => m.seat === s); }

function renderLobby() {
  if (!S.net || S.net.started || S.screen !== 'home') return;
  const host = S.net.role === 'host';
  const rows = [];
  for (let s = 0; s < 4; s++) {
    const m = memberOfSeat(s);
    rows.push(h('div', { class: 'seat-row' + (m ? '' : ' wait') },
      m && m.profile ? h('img', { class: 'mini-av', src: portraitUrl(m.profile.avatar) }) : h('span', { class: 'mini-av empty' }),
      h('span', { class: 'who' }, m ? m.name : '等待加入…'),
      h('span', { class: 'kind' }, m ? (s === 0 ? '房主' : m.id === S.room.myId ? '我' : '遠端') : `開始時由 AI（${lvName(S.net.cfg.aiLevel)}）補位`)));
  }
  const watchers = S.net.members.filter((m) => m.seat < 0);
  const content = h('div', {},
    h('div', { class: 'lobby-head' }, h('b', {}, '房號'), h('span', { class: 'muted small' }, MATCH_LENGTHS.find(([v]) => v === S.net.cfg.length)?.[1] || '')),
    h('div', { class: 'room-code' }, S.net.code.replace(/(\d{3})(\d{3})/, '$1 $2')),
    h('div', { class: 'seat-list' }, rows),
    watchers.length ? h('div', { class: 'muted small' }, `觀眾：${watchers.map((w) => w.name).join('、')}`) : null,
    host
      ? h('div', { class: 'net-row' },
        h('button', { onclick: () => { navigator.clipboard.writeText(S.net.code); toast('已複製房號', 'ok'); } }, '複製房號'),
        h('button', { onclick: () => { closeNet(); netWait(null); } }, '取消'),
        h('button', { class: 'primary', id: 'btnStartNet', onclick: () => hostStartGame() }, '開始打牌'))
      : h('div', { class: 'net-row' }, h('span', { class: 'muted small spin' }, '等待房主開始…'), h('button', { onclick: () => { closeNet(); netWait(null); } }, '離開')),
    host ? h('div', { class: 'muted small' }, '請把房號告訴朋友，對方在「加入房間」輸入即可。開始後加入的人會成為觀眾。') : null);
  netWait(content);
}

function renderMembers() {
  const box = $('#memberList');
  if (!box || !S.net || !S.room) return;
  box.innerHTML = '';
  for (const m of S.net.members) {
    box.append(h('span', { class: 'member' + (m.voice ? ' voice' : '') },
      m.profile ? h('img', { src: portraitUrl(m.profile.avatar) }) : null, `${m.name}${m.seat < 0 ? '（觀眾）' : ''}${m.id === S.room.myId ? '（我）' : ''}`));
  }
  const n = S.net.members.filter((m) => m.voice).length;
  $('#voiceState').textContent = S.voice.on ? `🟢 語音中（${n} 人）` : n ? `語音：${n} 人通話中` : '語音：未通話';
}

async function hostRoom(cfg) {
  closeNet();
  netWait(h('span', {}, '正在建立房間…'));
  const room = new Room(S.settings);
  S.room = room;
  try {
    const code = await room.host();
    S.net = { role: 'host', code, cfg, started: false, members: [{ id: room.myId, name: myName(), seat: 0, voice: false, profile: myProfile() }], mySeat: 0 };
    room.on('member-msg', (id, m) => queueNet(() => onHostMsg(id, m)));
    room.on('member-lost', (id, reason) => queueNet(() => onMemberLost(id, reason)));
    room.on('call', (call) => onVoiceCall(call));
    renderLobby();
  } catch (e) {
    netWait(h('span', { class: 'err' }, '建立房間失敗：' + errMsg(e)));
    S.room = null;
  }
}

function broadcastRoster() {
  if (!S.net || S.net.role !== 'host') return;
  S.room.send({ t: 'roster', members: S.net.members.map(({ id, name, seat, voice: vo, profile }) => ({ id, name, seat, voice: vo, profile })), cfg: S.net.cfg, started: S.net.started });
  renderLobby();
  renderMembers();
}

function hostStartGame() {
  if (!S.net || S.net.role !== 'host') return;
  const cfg = S.net.cfg;
  const used = S.net.members.flatMap((m) => (m.profile ? [m.profile.avatar, m.profile.advisor] : []));
  const seats = [0, 1, 2, 3].map((s) => {
    const m = memberOfSeat(s);
    if (!m) return aiSeat(cfg.aiLevel ?? 2, used);
    return { name: m.name, kind: s === 0 ? 'me' : 'remote', profile: m.profile || randomProfile(used) };
  });
  S.net.started = true;
  setupMatch('net', cfg, seats, 0);
  S.match = new Match({ length: cfg.length, base: cfg.base, perTai: cfg.perTai });
  S.room.send({ t: 'start', meta: { ...metaInfo(), matchId: S.matchId } });
  broadcastRoster();
  chatSys('牌局開始！');
  versus().then(() => authNextHand());
}

let netChain = Promise.resolve();
function queueNet(fn) { netChain = netChain.then(fn).catch((e) => console.error('net msg', e)); }

async function onHostMsg(id, m) {
  const mem = S.net.members.find((x) => x.id === id);
  switch (m.t) {
    case 'hello': {
      if (m.ver !== PROTOCOL) { S.room.sendTo(id, { t: 'old', text: '雙方程式版本不同，請先更新到最新版。' }); setTimeout(() => S.room.kick(id), 400); return; }
      const name = String(m.name || '牌友').slice(0, 16);
      const profile = validProfile(m.profile) ? m.profile : null;
      let seat = -1;
      if (!S.net.started) {
        for (let s = 1; s < 4; s++) if (!memberOfSeat(s)) { seat = s; break; }
      } else if (S.hand && !S.matchOver) {
        // 斷線重連：拿回原本的座位
        const s = S.seats.findIndex((st) => st.kind === 'ai' && st.left && st.leftName === name);
        if (s >= 0 && !memberOfSeat(s)) { seat = s; Object.assign(S.seats[s], { kind: 'remote', left: false, name }); }
      }
      S.net.members.push({ id, name, seat, voice: false, profile, lastEv: 0 });
      S.room.sendTo(id, { t: 'welcome', seat });
      if (S.net.started && S.hand) {
        S.room.sendTo(id, { t: 'start', meta: { ...metaInfo() }, history: S.match.history });
        if (seat >= 0) chatSys(`${name} 回來了，接回座位`); else chatSys(`${name} 加入觀戰`);
        pushStates();
        renderAll();
      }
      broadcastRoster();
      break;
    }
    case 'act': {
      if (!mem || mem.seat < 0 || !S.hand || S.hand.result) return;
      if (!humanAct(mem.seat, m.a)) pushStates(id);
      break;
    }
    case 'proxy':
      if (mem && mem.seat >= 0) {
        S.proxy[mem.seat] = !!m.on;
        chatSys(`${mem.name} ${m.on ? '請軍師代打' : '換回真人'}`);
        authRefresh();
      }
      break;
    case 'chat': {
      if (!mem) return;
      const text = String(m.text || '').slice(0, 500);
      S.room.send({ t: 'chat', name: mem.name, seat: mem.seat, text }, id);
      chatLine(mem.name, mem.seat, text, false);
      break;
    }
    case 'voice':
      if (mem) { mem.voice = !!m.on; broadcastRoster(); }
      break;
    case 'sync-req':
      pushStates(id);
      break;
  }
}

function onMemberLost(id, reason) {
  const i = S.net.members.findIndex((x) => x.id === id);
  if (i < 0) return;
  const mem = S.net.members[i];
  S.net.members.splice(i, 1);
  closeCall(id);
  if (S.net.started && mem.seat >= 0 && S.mode === 'net' && !S.matchOver) {
    const st = S.seats[mem.seat];
    Object.assign(st, { kind: 'ai', left: true, leftName: mem.name, level: S.net.cfg.aiLevel ?? 2 });
    chatSys(`${mem.name}${reason}，暫時由 AI 代打`);
    authRefresh();
  } else if (S.screen === 'game') chatSys(`${mem.name} 離開了`);
  broadcastRoster();
}

async function joinRoom(code) {
  closeNet();
  netWait(h('span', {}, '正在連線…'));
  const room = new Room(S.settings);
  S.room = room;
  S.net = { role: 'guest', code: String(code).replace(/\D/g, ''), members: [], started: false, mySeat: -1, cfg: {} };
  room.on('connected', () => room.send({ t: 'hello', name: myName(), ver: PROTOCOL, profile: myProfile() }));
  room.on('msg', (m) => queueNet(() => onGuestMsg(m)));
  room.on('lost', (reason) => {
    if (S.room !== room) return;
    endVoice();
    if (S.screen === 'game' && S.mode === 'net') {
      S.net.status = '⚠ ' + reason + '，牌局中斷';
      chatSys(reason);
      renderAll();
      toast(reason, 'err', 6000);
    } else netWait(h('span', { class: 'err' }, reason));
  });
  room.on('call', (call) => onVoiceCall(call));
  try {
    await room.join(code);
  } catch (e) {
    netWait(h('span', { class: 'err' }, errMsg(e)));
    S.room = null;
    room.close();
  }
}

function applyMeta(meta) {
  S.scores = meta.scores; S.label = meta.label; S.handNo = meta.handNo; S.matchOver = meta.matchOver; S.cfg = meta.cfg;
  if (meta.matchId) S.matchId = meta.matchId;
  S.proxy = meta.proxy.slice();
  S.seats = meta.seats.map((st, s) => ({ ...st, kind: s === S.mySeat ? 'me' : st.kind === 'ai' ? 'ai' : 'remote' }));
  S.guestDeadlines = Object.fromEntries(Object.entries(meta.deadlines || {}).map(([s, ms]) => [s, Date.now() + ms]));
}

async function onGuestMsg(m) {
  switch (m.t) {
    case 'full': netWait(h('span', { class: 'err' }, '這個房間人數已滿')); closeNet(); break;
    case 'old': netWait(h('span', { class: 'err' }, m.text || '版本不相容')); toast(m.text || '版本不相容', 'err', 8000); break;
    case 'end':
      if (S.mode === 'net') { S.net.status = '⚠ 房主已關閉房間'; chatSys('房主已關閉房間'); renderAll(); }
      else netWait(h('span', { class: 'err' }, '房主已關閉房間'));
      break;
    case 'welcome': S.net.mySeat = m.seat; break;
    case 'roster':
      S.net.members = m.members || [];
      S.net.cfg = m.cfg || {};
      renderLobby();
      renderMembers();
      break;
    case 'start': {
      S.net.started = true;
      S.net.status = '';
      const mySeat = S.net.mySeat ?? -1;
      S.mySeat = mySeat;
      applyMeta(m.meta);
      setupMatch('net', m.meta.cfg, S.seats, mySeat, m.meta.matchId);
      S.history = (m.history || []).slice();
      netWait(null);
      renderMembers();
      chatSys(mySeat >= 0 ? `牌局開始！您坐${WIND_NAMES[mySeat]}位。` : '牌局開始！您是觀眾。');
      xk.win.attention('牌局開始', '');
      if (mySeat >= 0) await versus();
      break;
    }
    case 'state': {
      if (S.mode !== 'net') return;
      applyMeta(m.meta);
      if (S.view && m.view && S.handNo !== S._lastHandNo) { advisor.reset(); $('#btnNext').classList.add('hidden'); }
      S._lastHandNo = S.handNo;
      S.view = m.view;
      S.opts = m.opts || [];
      handleEvents(m.ev || []);
      renderAll();
      if (m.view.result) showHandResult(m.view, m.meta);
      break;
    }
    case 'handlog': {
      // 來賓也把每一局存起來、學進智庫
      S.history.push(m.entry);
      applyMeta(m.meta);
      const meta = { seed: m.entry.seed, dealer: m.entry.dealer, roundWind: m.entry.roundWind, streak: m.entry.streak, base: m.meta.cfg?.base ?? 50, perTai: m.meta.cfg?.perTai ?? 20 };
      if (S.kb.learnHand(meta, m.entry.log, `${S.matchId}#${m.entry.no}`)) saveKB();
      saveRecord(S.history);
      break;
    }
    case 'chat': chatLine(m.name, m.seat, String(m.text || '').slice(0, 500), false); break;
  }
}

function closeNet() {
  endVoice();
  if (S.room) {
    if (S.net && S.net.role === 'host') S.room.send({ t: 'end' });
    S.room.close();
    S.room = null;
  }
  if (S.net) S.net.started = false;
}

// ---------------- 文字聊天 ----------------
function chatLine(name, seat, text, me) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg' + (me ? ' me' : '') }, h('b', {}, me ? '我' : `${name}${seat < 0 ? '（觀眾）' : ''}`), h('span', {}, text)));
  log.scrollTop = log.scrollHeight;
  if (!me && !$('#pane-chat').classList.contains('on')) $('.tab[data-tab="chat"]').classList.add('ping');
}
function chatSys(text) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg sys' }, text));
  log.scrollTop = log.scrollHeight;
}
function sendChat() {
  const inp = $('#chatInput');
  const text = inp.value.trim();
  if (!text || !S.room || !S.room.connected) return;
  if (S.net.role === 'host') S.room.send({ t: 'chat', name: myName(), seat: S.net.mySeat, text });
  else S.room.send({ t: 'chat', text });
  chatLine(myName(), S.net.mySeat, text, true);
  inp.value = '';
}

// ---------------- 語音通話（多人，兩兩直連） ----------------
async function getMic() {
  await xk.sys.askMicrophone();
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}
function announceVoice(on) {
  if (!S.net || !S.room) return;
  if (S.net.role === 'host') {
    const me = S.net.members.find((x) => x.id === S.room.myId);
    if (me) me.voice = on;
    broadcastRoster();
  } else S.room.send({ t: 'voice', on });
}
function setVoiceUI() {
  $('#btnVoice').textContent = S.voice.on ? '⏹ 離開語音' : '🎤 加入語音';
  $('#btnMute').classList.toggle('hidden', !S.voice.on);
  $('#voiceBar').classList.toggle('on', S.voice.on);
  if (music) music.setDuck(S.voice.on && S.voice.calls.size > 0);
  renderMembers();
}
async function toggleVoice() {
  if (S.voice.on) { endVoice(); return; }
  if (!S.room || !S.room.connected) { toast('尚未連線', 'err'); return; }
  try { S.voice.mic = await getMic(); } catch (e) { toast('無法開啟麥克風：' + errMsg(e), 'err'); return; }
  S.voice.on = true;
  announceVoice(true);
  for (const m of S.net.members) if (m.voice && m.id !== S.room.myId && !S.voice.calls.has(m.id)) setupCall(m.id, S.room.call(m.id, S.voice.mic));
  setVoiceUI();
  chatSys('您已加入語音通話');
}
function onVoiceCall(call) {
  if (!S.voice.on || !S.voice.mic) { try { call.close(); } catch {} return; }
  if (S.voice.calls.has(call.peer)) closeCall(call.peer);
  call.answer(S.voice.mic);
  setupCall(call.peer, call);
}
function setupCall(id, call) {
  S.voice.calls.set(id, call);
  call.on('stream', (stream) => {
    let a = document.getElementById('aud-' + id);
    if (!a) { a = h('audio', { id: 'aud-' + id, autoplay: true }); $('#remoteAudios').append(a); }
    a.srcObject = stream;
    a.play().catch(() => {});
    setVoiceUI();
  });
  call.on('close', () => { if (S.voice.calls.get(id) === call) closeCall(id); });
  call.on('error', () => { if (S.voice.calls.get(id) === call) closeCall(id); });
}
function closeCall(id) {
  const c = S.voice.calls.get(id);
  S.voice.calls.delete(id);
  if (c) { try { c.close(); } catch {} }
  const a = document.getElementById('aud-' + id);
  if (a) { a.srcObject = null; a.remove(); }
  if (music) setVoiceUI();
}
function toggleMute() {
  if (!S.voice.mic) return;
  const t = S.voice.mic.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $('#btnMute').textContent = t.enabled ? '🔇 靜音' : '🔈 取消靜音';
}
function endVoice() {
  const was = S.voice.on;
  for (const id of [...S.voice.calls.keys()]) closeCall(id);
  if (S.voice.mic) { S.voice.mic.getTracks().forEach((t) => t.stop()); S.voice.mic = null; }
  S.voice.on = false;
  if (was) { announceVoice(false); if (S.screen === 'game') chatSys('已離開語音通話'); }
  if (music) setVoiceUI();
}

// ---------------- 麻將智庫（牌譜、學習統計） ----------------
const MODE_NAME = { ai: '一人對三 AI', net: '遠端真人', aivai: '全部 AI', import: '匯入' };

async function renderKB() {
  const body = $('#kbBody');
  body.innerHTML = '';
  const list = await xk.games.list();
  const sum = S.kb.summary();
  const pct = (x) => (sum.total ? Math.round((x / sum.total) * 100) : 0);
  body.append(h('div', { class: 'rec-head' },
    h('div', {}, h('h2', {}, '📚 麻將智庫'), h('p', { class: 'muted' }, '每打完一局，牌譜都會存進智庫；AI 會從這些牌局學習哪些牌容易放槍、什麼時候吃碰比較划算。')),
    h('div', { class: 'rec-actions' },
      h('button', { onclick: importRecords }, '匯入牌譜'),
      h('button', { onclick: relearnAll, title: '依照所有牌譜重新統計' }, '重新學習'),
      h('button', { onclick: () => showScreen('home') }, '返回首頁'))));
  const stats = h('div', { class: 'kb-stats' },
    h('div', { class: 'kb-card' }, h('b', {}, String(sum.total)), h('span', {}, '已學習局數')),
    h('div', { class: 'kb-card' }, h('b', {}, `${pct(sum.wins.self)}%`), h('span', {}, '自摸')),
    h('div', { class: 'kb-card' }, h('b', {}, `${pct(sum.wins.ron)}%`), h('span', {}, '放槍胡')),
    h('div', { class: 'kb-card' }, h('b', {}, `${pct(sum.wins.draw)}%`), h('span', {}, '流局')),
    h('div', { class: 'kb-card' }, h('b', {}, sum.avgTai.toFixed(1)), h('span', {}, '平均台數')));
  const taiBox = h('div', { class: 'kb-box' }, h('h4', {}, '最常出現的台型'),
    sum.taiTop.length ? h('div', { class: 'kb-bars' }, sum.taiTop.map(([name, n]) => h('div', { class: 'kb-bar' }, h('span', {}, name), h('i', { style: { width: Math.round((n / sum.taiTop[0][1]) * 100) + '%' } }), h('em', {}, String(n))))) : h('p', { class: 'muted' }, '還沒有資料'));
  const dangerBox = h('div', { class: 'kb-box' }, h('h4', {}, '放槍率最高的情況（AI 會避開）'),
    sum.dangerRows.length ? h('table', { class: 'kb-table' }, h('tbody', {}, sum.dangerRows.slice(0, 8).map((r) => h('tr', {}, h('td', {}, r.label), h('td', { class: 'n' }, `${(r.rate * 100).toFixed(1)}%`), h('td', { class: 'n muted' }, `${r.n} 次`))))) : h('p', { class: 'muted' }, '資料累積中（每種情況至少 20 次才列出）'));
  const callBox = h('div', { class: 'kb-box' }, h('h4', {}, '吃碰之後的平均結果（胡＋1、放槍－1）'),
    sum.callRows.length ? h('table', { class: 'kb-table' }, h('tbody', {}, sum.callRows.map((r) => h('tr', {}, h('td', {}, r.label), h('td', { class: 'n ' + (r.avg >= 0 ? 'up' : 'down') }, r.avg.toFixed(3)), h('td', { class: 'n muted' }, `${r.n} 次`))))) : h('p', { class: 'muted' }, '還沒有資料'));
  body.append(stats, h('div', { class: 'kb-grid' }, taiBox, dangerBox, callBox));
  if (!list.length) {
    body.append(h('div', { class: 'empty' }, '還沒有牌譜。每打完一局都會自動收錄在這裡。'));
    return;
  }
  body.append(h('h3', { class: 'kb-sub' }, '牌譜'), h('div', { class: 'rec-wrap' }, h('table', { class: 'rec-table' },
    h('thead', {}, h('tr', {}, ...['日期', '類型', '參賽者（分數）', '局數', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, list.map((g) => h('tr', {},
      h('td', {}, fmtDate(g.date)),
      h('td', {}, MODE_NAME[g.mode] || g.mode || ''),
      h('td', { class: 'names' }, g.names.map((n, s) => h('span', { class: 'rec-name' + (s === g.mySeat ? ' me' : '') }, `${n}（${g.scores[s] ?? ''}）`))),
      h('td', {}, `${g.hands} 局${g.finished ? '' : '（未完）'}`),
      h('td', { class: 'ops' },
        h('button', { onclick: () => openReplay(g.id) }, '重播'),
        h('button', { onclick: () => exportRecord(g.id) }, '匯出'),
        h('button', { class: 'danger', onclick: async () => { if (await modal('刪除牌譜', '確定刪除這份牌譜？（智庫裡學過的統計會保留）', [{ label: '取消', value: false }, { label: '刪除', value: true, primary: true }])) { await xk.games.delete(g.id); renderKB(); } } }, '刪除'))))))));
}

async function relearnAll() {
  const all = await xk.games.all();
  S.kb = new KnowledgeBase();
  let n = 0;
  for (const rec of all) n += S.kb.learnMatch(rec);
  await xk.kb.set(S.kb.toJSON());
  toast(`已從 ${all.length} 份牌譜重新學習 ${n} 局`, 'ok');
  renderKB();
}

function recordText(rec) {
  const lines = [`[${APP_NAME} 牌譜]`, `日期：${fmtDate(rec.date)}`, ...rec.names.map((n, s) => `第 ${s + 1} 家：${n}（${rec.scores?.[s] ?? ''}）`), ''];
  for (const hd of rec.history || []) {
    const r = hd.result;
    lines.push(`第 ${hd.no} 局（${WIND_NAMES[hd.roundWind]}風圈，莊 ${rec.names[hd.dealer]}）：${r.type === 'draw' ? '流局' : `${rec.names[r.winner]} ${r.selfDraw ? '自摸' : `胡 ${rec.names[r.from]}`} ${r.tai} 台（${r.items.map((x) => x.name).join('、') || '屁胡'}）`}`);
  }
  lines.push('', '資料：' + JSON.stringify({ kind: 'xiaoke-mahjong', ...rec }));
  return lines.join('\r\n');
}

async function exportRecord(id) {
  const rec = await xk.games.get(id);
  if (!rec) return;
  const p = await xk.games.export(`麻將牌譜_${(rec.id || '').slice(0, 12)}.txt`, recordText(rec));
  if (p) toast('已匯出：' + p, 'ok', 5000);
}

async function importRecords() {
  const files = await xk.games.pickImport();
  if (!files.length) return;
  let ok = 0, bad = 0, learned = 0;
  for (const f of files) {
    try {
      if (f.error) throw new Error(f.error);
      const t = f.text.trim();
      let data = null;
      if (t.startsWith('{') || t.startsWith('[')) data = JSON.parse(t);
      else { const m = /資料[:：]\s*(\{.*\})\s*$/m.exec(t); if (m) data = JSON.parse(m[1]); }
      if (!data) throw new Error('無法辨識');
      for (const r of Array.isArray(data) ? data : [data]) {
        if (!Array.isArray(r.history) || !r.history.length) { bad++; continue; }
        // 每局都要能重播
        for (const hd of r.history) replayHand({ seed: hd.seed, dealer: hd.dealer, roundWind: hd.roundWind, streak: hd.streak, base: r.cfg?.base, perTai: r.cfg?.perTai }, hd.log);
        const rec = { ...r, kind: undefined, id: r.id || newMatchId(), mode: r.mode || 'import' };
        await xk.games.save(rec);
        learned += S.kb.learnMatch(rec);
        ok++;
      }
    } catch { bad++; }
  }
  if (learned) await xk.kb.set(S.kb.toJSON());
  toast(`匯入 ${ok} 份牌譜（學習 ${learned} 局）${bad ? `，${bad} 份無法辨識` : ''}`, ok ? 'ok' : 'err');
  renderKB();
}

// ---------------- 牌譜重播 ----------------
async function openReplay(id) {
  const rec = await xk.games.get(id);
  if (!rec || !(rec.history || []).length) return;
  stopTimers();
  S.mode = 'replay';
  S.seats = rec.names.map((name, s) => ({ name, kind: 'replay', profile: (rec.profiles || [])[s] || randomProfile() }));
  S.mySeat = -1;
  S.proxy = [false, false, false, false];
  S.replay = { rec, hi: 0, step: 0, log: [], timer: 0 };
  document.body.className = 'mode-replay';
  table.showAll = true;
  $('#eventLog').innerHTML = '';
  showScreen('game');
  selectTab('log');
  replayHandAt(0);
}

function replayHandAt(i) {
  const r = S.replay;
  if (!r) return;
  i = Math.max(0, Math.min(r.rec.history.length - 1, i));
  r.hi = i;
  const hd = r.rec.history[i];
  r.meta = { seed: hd.seed, dealer: hd.dealer, roundWind: hd.roundWind, streak: hd.streak, base: r.rec.cfg?.base ?? 50, perTai: r.rec.cfg?.perTai ?? 20 };
  r.log = hd.log || [];
  S.handNo = hd.no;
  S.label = `${WIND_NAMES[hd.roundWind]}風圈`;
  const before = i > 0 ? r.rec.history[i - 1].scores : [0, 1, 2, 3].map(() => (r.rec.history[0].scores[0] - r.rec.history[0].deltas[0]) || 2000);
  S.scores = before.slice();
  $('#eventLog').innerHTML = '';
  logLine(`── 第 ${hd.no} 局（${WIND_NAMES[hd.roundWind]}風圈，莊 ${seatName(hd.dealer)}）──`, 'sys');
  replayGo(0);
}

function replayGo(step) {
  const r = S.replay;
  if (!r) return;
  step = Math.max(0, Math.min(r.log.length, step));
  const forward = step === r.step + 1;
  const hd = replayHand(r.meta, r.log, step);
  r.step = step;
  if (forward) handleEvents(hd.events.slice(r.evN || 0));
  r.evN = hd.events.length;
  S.view = hd.view('all');
  S.opts = [];
  if (hd.result) S.scores = r.rec.history[r.hi].scores.slice();
  renderAll();
  $('#rpInfo').textContent = `第 ${r.hi + 1}/${r.rec.history.length} 局`;
}

function replayAuto() {
  const r = S.replay;
  if (!r) return;
  if (r.timer) { stopReplayAuto(); return; }
  $('#rpPlay').textContent = '⏸';
  r.timer = setInterval(() => {
    if (r.step >= r.log.length) {
      if (r.hi < r.rec.history.length - 1) { replayHandAt(r.hi + 1); return; }
      stopReplayAuto(); return;
    }
    replayGo(r.step + 1);
  }, 700);
}
function stopReplayAuto() {
  if (S.replay && S.replay.timer) { clearInterval(S.replay.timer); S.replay.timer = 0; }
  const b = $('#rpPlay'); if (b) b.textContent = '▶';
}

// ---------------- 關於與版本更新 ----------------
async function openAbout() {
  const status = h('div', { class: 'upd-status muted' }, '正在檢查是否有新版本…');
  const body = h('div', { class: 'about' },
    h('div', { class: 'about-head' }, h('img', { class: 'hero-icon small', src: '../../build/icon.png' }),
      h('div', {}, h('h2', {}, APP_NAME), h('div', { class: 'muted' }, `版本 v${S.info.version}　（${{ darwin: 'macOS', win32: 'Windows', android: 'Android', web: '網頁版' }[S.info.platform] || S.info.platform}）`))),
    h('p', { class: 'credit-line' }, CREDIT),
    h('p', { class: 'muted small' }, '3D 台灣 16 張麻將：一人對三位 AI、邀約遠端真人（空位 AI 補位、觀戰、語音與文字聊天）、全部 AI 對戰；AI 軍師指點與代打；麻將智庫（牌譜、重播、AI 學習）；20 首原創背景音樂；遊戲說明（動畫與語音）。'),
    h('p', { class: 'muted small' }, '規則與台數參考：github.com/yuweiiihuang/mahjong16（台灣 16 張麻將環境）'),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.settings.autoUpdate !== false, onchange: (e) => saveSettings({ autoUpdate: e.target.checked }) }), ' 開啟程式時自動檢查新版本'),
    status);
  const p = modal('關於與更新', body, [{ label: '關閉', value: false, primary: true }]);
  checkUpdate(true, status);
  await p;
}

async function checkUpdate(manual, statusEl) {
  let info;
  try { info = await xk.update.check(); }
  catch (e) { if (statusEl) statusEl.textContent = '無法檢查更新：' + errMsg(e); return; }
  if (!info.newer) { if (statusEl) statusEl.textContent = `✅ 已經是最新版本（v${info.current}）`; return; }
  const go = () => startUpdate(info);
  if (statusEl) {
    statusEl.innerHTML = '';
    statusEl.append(h('span', {}, `🔔 有新版本 v${info.latest}（目前 v${info.current}）　`),
      h('button', { class: 'primary', id: 'btnDoUpdate', onclick: () => { $$('.modal-back').forEach((b) => b.remove()); go(); } }, '立即更新'));
    return;
  }
  const v = await modal(`發現新版本 v${info.latest}`, h('div', {},
    h('p', {}, `目前版本 v${info.current}，要更新到 v${info.latest} 嗎？`),
    info.notes ? h('pre', { class: 'upd-notes' }, info.notes) : null), [{ label: '稍後再說', value: false }, { label: '立即更新', value: true, primary: true }]);
  if (v) go();
}

async function startUpdate(info) {
  if (!info.canInstall) {
    const v = await modal('下載新版本', h('p', {}, info.flavor === 'dev' ? '目前是開發版，請到 GitHub 下載安裝檔。' : '找不到這個平台的安裝檔，請到 GitHub 下載。'), [{ label: '取消', value: false }, { label: '開啟下載頁', value: true, primary: true }]);
    if (v) xk.update.openPage();
    return;
  }
  const bar = h('div', { class: 'upd-bar' }, h('div', { class: 'upd-fill' }));
  const txt = h('div', { class: 'muted small' }, '準備下載…');
  const box = h('div', { class: 'upd-box' }, h('b', {}, `正在下載 v${info.latest}`), bar, txt);
  document.body.append(box);
  const off = xk.update.onProgress(({ got, total }) => {
    const pct = total ? Math.floor((got / total) * 100) : 0;
    bar.firstChild.style.width = pct + '%';
    txt.textContent = `${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB（${pct}%）`;
  });
  try {
    const file = await xk.update.download();
    off();
    txt.textContent = info.flavor === 'mac' ? '下載完成，正在開啟安裝檔…' : info.flavor === 'android' ? '下載完成，正在開啟安裝畫面…' : '下載完成，正在安裝，程式會自動重新開啟…';
    const r = await xk.update.install(file);
    if (r.manual) {
      box.remove();
      await modal('請完成安裝', h('div', {},
        info.flavor === 'android' ? h('p', {}, '請在 Android 的安裝畫面按「更新」或「安裝」，完成後重新開啟小柯麻將。') : h('p', {}, '新版安裝檔已開啟（也放在「下載」資料夾）。'),
        info.flavor === 'android' ? null : h('p', {}, info.flavor === 'mac' ? `請先結束本程式，再把「${APP_NAME}」拖到「應用程式」資料夾覆蓋舊版。` : '請依照畫面指示完成安裝。')));
    }
  } catch (e) {
    off();
    box.remove();
    toast('更新失敗：' + errMsg(e), 'err', 8000);
  }
}

// ---------------- 設定 ----------------
async function openSettings() {
  const s = S.settings;
  const f = {};
  const row = (label, el, tip) => h('div', { class: 'set-row' }, h('label', {}, label), el, tip ? h('div', { class: 'muted small' }, tip) : null);
  f.name = h('input', { value: s.playerName });
  f.sfx = h('input', { type: 'checkbox', checked: s.sfx });
  f.voiceCall = h('input', { type: 'checkbox', checked: s.voiceCall !== false });
  f.autoplay = h('input', { type: 'checkbox', checked: s.music.autoplay });
  f.autoUpdate = h('input', { type: 'checkbox', checked: s.autoUpdate !== false });
  f.key = h('input', { type: 'password', placeholder: s.advisor.hasKey ? '（已設定，留空表示不變更）' : 'sk-ant-…' });
  f.model = h('select', {}, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((m) => h('option', { value: m, selected: s.advisor.model === m }, m)));
  f.effort = h('select', {}, [['low', '快速（low）'], ['medium', '一般（medium）'], ['high', '深入（high）']].map(([v, l]) => h('option', { value: v, selected: s.advisor.effort === v }, l)));
  f.srvMode = h('select', {}, h('option', { value: 'public', selected: s.server.mode !== 'custom' }, '公用配對伺服器（PeerJS Cloud）'), h('option', { value: 'custom', selected: s.server.mode === 'custom' }, '自架伺服器'));
  f.host = h('input', { value: s.server.host, placeholder: '例如 peer.example.com' });
  f.port = h('input', { value: s.server.port, type: 'number', style: { width: '90px' } });
  f.path = h('input', { value: s.server.path, style: { width: '90px' } });
  f.secure = h('input', { type: 'checkbox', checked: s.server.secure });
  f.stun = h('textarea', { rows: 2, value: s.stun });
  f.turnUrls = h('input', { value: s.turn.urls, placeholder: 'turn:turn.example.com:3478' });
  f.turnUser = h('input', { value: s.turn.username, placeholder: '帳號' });
  f.turnPass = h('input', { type: 'password', value: s.turn.credential, placeholder: '密碼' });
  const testOut = h('div', { class: 'muted small' });
  const body = h('div', { class: 'settings' },
    h('h4', {}, '一般'),
    row('我的暱稱', f.name),
    row('頭像與軍師', h('button', { onclick: () => chooseProfile(false) }, '更換頭像與 AI 軍師')),
    row('音效', h('label', { class: 'chk' }, f.sfx, ' 摸牌、打牌、吃碰音效')),
    row('語音報牌', h('label', { class: 'chk' }, f.voiceCall, ' 唸出打出的牌與「吃、碰、槓、胡」'), voice.available ? `語音：${voice.voiceName}` : '這台電腦沒有中文語音，無法報牌'),
    row('背景音樂', h('label', { class: 'chk' }, f.autoplay, ' 開啟程式後自動播放')),
    row('版本更新', h('label', { class: 'chk' }, f.autoUpdate, ' 開啟程式時自動檢查新版本')),
    h('h4', {}, 'AI 軍師（Claude）'),
    row('Anthropic API 金鑰', f.key, s.advisor.envKey && !s.advisor.hasKey ? '已偵測到環境變數 ANTHROPIC_API_KEY。' : '金鑰會加密存在本機，只用來呼叫 Claude。沒有金鑰時軍師仍會提供本機 AI 的建議。'),
    row('模型', f.model),
    row('思考深度', f.effort),
    h('div', { class: 'set-row' }, h('label', {}, ''), h('button', { onclick: async () => { testOut.textContent = '測試中…'; await applySettings(f); const r = await xk.advisor.test(); testOut.textContent = r.ok ? `✅ ${r.text}` : `❌ ${r.error}`; } }, '測試金鑰'), testOut),
    h('h4', {}, '遠端連線'),
    row('配對伺服器', f.srvMode),
    row('自架伺服器', h('div', { class: 'inline' }, f.host, f.port, f.path, h('label', { class: 'chk' }, f.secure, ' HTTPS'))),
    row('STUN', f.stun),
    row('TURN（跨網路連不上時）', h('div', { class: 'inline' }, f.turnUrls, f.turnUser, f.turnPass)),
    h('h4', {}, '版本'),
    h('div', { class: 'set-row' }, h('label', {}, `目前 v${S.info.version}`), h('button', { onclick: () => { $$('.modal-back').forEach((b) => b.remove()); openAbout(); } }, '檢查更新')),
    h('p', { class: 'credit-line small' }, `${APP_NAME} v${S.info.version}．${CREDIT}`),
  );
  const ok = await modal('設定', body, [{ label: '取消', value: false }, { label: '儲存', value: true, primary: true }]);
  if (ok) { await applySettings(f); toast('設定已儲存', 'ok'); renderHome(); }
}

async function applySettings(f) {
  const patch = {
    playerName: f.name.value.trim() || '牌友',
    sfx: f.sfx.checked,
    voiceCall: f.voiceCall.checked,
    autoUpdate: f.autoUpdate.checked,
    music: { autoplay: f.autoplay.checked },
    advisor: { model: f.model.value, effort: f.effort.value },
    server: { mode: f.srvMode.value, host: f.host.value.trim(), port: Number(f.port.value) || 9000, path: f.path.value.trim() || '/', secure: f.secure.checked },
    stun: f.stun.value,
    turn: { urls: f.turnUrls.value.trim(), username: f.turnUser.value.trim(), credential: f.turnPass.value },
  };
  if (f.key.value.trim()) patch.advisor.apiKey = f.key.value.trim();
  await saveSettings(patch);
  f.key.value = '';
  setSfx(S.settings.sfx);
  voice.enabled = S.settings.voiceCall !== false;
  advisor.setHasKey(S.settings.advisor.hasKey);
  renderVolume();
}

window.addEventListener('beforeunload', () => { closeNet(); });
init().catch((e) => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, '啟動失敗：' + (e.stack || e))); });

export { decodeAction };

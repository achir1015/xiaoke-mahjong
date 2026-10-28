// AI 軍師小視窗：本機 AI 分析＋（有金鑰時）Claude 白話解說
import { h, uid } from './util.js';
import { tileType, typeName, WIND_NAMES } from './tiles.js';
import { analyze, describeCand, decide } from './ai.js';
import { portraitUrl, labelOf } from './portraits.js';

const QUICK = [
  ['該打哪張？', '現在輪到我，該打哪一張比較好？'],
  ['要不要吃碰？', '這張牌我要不要吃或碰？為什麼？'],
  ['我聽什麼？', '我現在聽哪些牌？還差幾步可以聽牌？'],
  ['誰比較危險？', '現在哪一家看起來快胡了？哪些牌比較安全？'],
  ['教我技巧', '台灣麻將有什麼實用的技巧？請配合目前的牌局說明。'],
];
const ACT_NAME = { pon: '碰', chi: '吃', kan: '槓', hu: '胡', pass: '過', tsumo: '自摸', ankan: '暗槓', kakan: '加槓', discard: '打出' };

export function actionText(a) {
  if (!a) return '';
  if (a.type === 'discard') return `打${typeName(a.t)}`;
  if (a.type === 'chi') return `吃（用${a.use.map(typeName).join('、')}）`;
  if (a.type === 'ankan' || a.type === 'kakan') return `${ACT_NAME[a.type]}${typeName(a.t)}`;
  return ACT_NAME[a.type] || a.type;
}

export class AdvisorPanel {
  // ctx(): { view, opts, mySeat, names, kb, showHint(t) }
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.history = [];
    this.busy = null;
    this.hasKey = false;
    this.build();
    xk.advisor.onDelta((d) => { if (this.busy && d.id === this.busy.id) { this.busy.text += d.text; this.busy.el.textContent = this.busy.text; this.scroll(); } });
    xk.advisor.onDone((d) => this.onDone(d));
  }

  setHasKey(v) {
    this.hasKey = v;
    this.modeEl.textContent = v ? '🟢 Claude 軍師（線上）' : '⚪ 離線軍師（本機 AI）';
    this.modeEl.title = v ? '使用 Claude 以白話解說 AI 分析' : '尚未設定 Anthropic API 金鑰，只提供 AI 建議。可到「設定」輸入金鑰。';
  }

  setAdvisor(id) {
    this.avatar.innerHTML = '';
    if (id) { this.avatar.append(h('img', { src: portraitUrl(id), alt: '' })); this.nameEl.textContent = `${labelOf(id)}（AI 軍師）`; }
    else { this.avatar.textContent = '🧙'; this.nameEl.textContent = '小柯軍師'; }
  }

  build() {
    this.modeEl = h('div', { class: 'adv-mode' });
    this.avatar = h('span', { class: 'adv-avatar' }, '🧙');
    this.nameEl = h('b', {}, '小柯軍師');
    this.log = h('div', { class: 'adv-log' });
    this.input = h('textarea', { class: 'adv-input', rows: 2, placeholder: '問軍師，例如：我該打哪張？（Enter 送出）', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } } });
    this.btnSend = h('button', { class: 'primary', onclick: () => this.send() }, '請教');
    this.root.append(
      h('div', { class: 'adv-head' }, this.avatar, h('div', {}, this.nameEl, this.modeEl)),
      this.log,
      h('div', { class: 'adv-quick' }, QUICK.map(([label, q]) => h('button', { class: 'chip', onclick: () => this.send(q) }, label))),
      h('div', { class: 'adv-send' }, this.input, this.btnSend),
    );
    this.say('ai', '您好！我是您的 AI 軍師。牌局中有任何疑問都可以問我，我會先請 AI 算一遍牌效與風險，再告訴您建議和理由。需要時也可以按「軍師代打」讓我幫您打。');
  }

  reset() {
    this.history = [];
    this.log.innerHTML = '';
    this.say('ai', '新的一局開始了，需要建議隨時叫我！');
  }

  say(who, text) {
    const el = h('div', { class: 'adv-msg ' + who }, text);
    this.log.append(el);
    this.scroll();
    return el;
  }
  scroll() { this.log.scrollTop = this.log.scrollHeight; }

  buildContext() {
    const { view, opts, mySeat, names, kb } = this.ctx();
    const me = view.players[mySeat];
    const tn = (ids) => ids.map((id) => (id < 0 ? '（蓋牌）' : typeName(tileType(id)))).join(' ') || '（無）';
    const meldText = (pl) => pl.melds.map((m) => `${{ chow: '吃', pung: '碰', kong: m.concealed ? '暗槓' : '槓' }[m.kind]}[${tn(m.tiles)}]`).join(' ') || '（無）';
    const ana = analyze(view, mySeat, kb);
    const myTurn = opts.some((o) => o.type === 'discard');
    const claim = opts.some((o) => ['pon', 'chi', 'kan', 'hu'].includes(o.type));
    const rec = opts.length ? decide(view, mySeat, opts, 3, kb) : null;
    const lines = [
      '【牌局資訊】',
      `${WIND_NAMES[view.roundWind]}風圈，莊家是${names[view.dealer] || ''}${view.streak ? `（連 ${view.streak}）` : ''}，牌牆剩 ${view.remaining} 張可摸。`,
      `您（${names[mySeat] || ''}）的門風：${WIND_NAMES[me.seatWind]}。`,
      `您的手牌：${tn(me.hand)}`,
      `您的吃碰槓：${meldText(me)}；花牌：${tn(me.flowers)}`,
      ...view.players.map((pl, s) => (s === mySeat ? null : `${names[s] || ''}（${WIND_NAMES[pl.seatWind]}家，手上 ${pl.count} 張，威脅度 ${['低', '中', '高'][ana.threats[s]]}）：明牌 ${meldText(pl)}；花 ${tn(pl.flowers)}；牌河 ${tn(pl.river)}`)).filter(Boolean),
      `您的牌河：${tn(me.river)}`,
      `目前 ${ana.shanten <= 0 ? (ana.shanten < 0 ? '已胡牌' : '已聽牌') : `${ana.shanten} 向聽`}。`,
      claim && view.claim ? `${names[view.claim.from] || ''}剛打出${typeName(tileType(view.claim.tile))}，您可以：${opts.map(actionText).join('、')}。` : '',
      myTurn ? 'AI 分析的候選打法（由好到壞）：' : '',
      ...(myTurn ? ana.ranked.map((c, i) => `${i + 1}. ${describeCand(c)}`) : []),
      rec ? `本機 AI 的建議：${actionText(rec)}` : '',
    ].filter(Boolean).join('\n');
    return { text: lines, ana, rec, myTurn, claim, view, mySeat };
  }

  send(q) {
    const question = (q || this.input.value).trim();
    if (!question || this.busy) return;
    const { view, mySeat } = this.ctx();
    if (!view || mySeat < 0) { this.say('ai', '目前沒有進行中的牌局，開一局之後再問我吧！'); return; }
    this.input.value = '';
    this.say('me', question);
    const pending = this.say('ai thinking', '軍師正在看牌…');
    let c;
    try { c = this.buildContext(); } catch (e) { pending.textContent = '分析失敗：' + e.message; pending.classList.remove('thinking'); return; }
    if (c.rec && c.rec.type === 'discard') this.ctx().showHint(c.rec.t);
    if (!this.hasKey) {
      pending.classList.remove('thinking');
      pending.textContent = this.offlineAnswer(c);
      this.scroll();
      return;
    }
    pending.textContent = '';
    pending.classList.add('streaming');
    const id = uid();
    this.busy = { id, el: pending, text: '', question };
    this.btnSend.textContent = '停止';
    this.btnSend.onclick = () => xk.advisor.cancel(id);
    const userMsg = { role: 'user', content: `${c.text}\n\n【我的問題】${question}` };
    this.busy.userMsg = userMsg;
    this.busy.offline = this.offlineAnswer(c);
    xk.advisor.ask(id, { messages: [...this.history.slice(-12), userMsg] });
  }

  onDone(d) {
    const b = this.busy;
    if (!b || d.id !== b.id) return;
    this.busy = null;
    this.btnSend.textContent = '請教';
    this.btnSend.onclick = () => this.send();
    b.el.classList.remove('thinking', 'streaming');
    if (d.error) {
      if (d.error === 'cancelled') { b.el.textContent = (b.text || '') + '（已停止）'; return; }
      if (d.error === 'nokey') { this.setHasKey(false); b.el.textContent = b.offline; return; }
      b.el.textContent = `${b.offline}\n\n⚠ ${d.error}`;
      return;
    }
    const text = d.text || b.text;
    b.el.textContent = text + (d.truncated ? '…' : '');
    this.history.push(b.userMsg, { role: 'assistant', content: text });
    this.scroll();
  }

  offlineAnswer(c) {
    const { ana, rec, view } = c;
    if (view.result) return '這一局已經結束了，可以到「麻將智庫」重播檢討喔。';
    const danger = ana.threats.map((t, s) => (t === 2 ? s : -1)).filter((s) => s >= 0);
    const names = this.ctx().names;
    const warn = danger.length ? `\n注意：${danger.map((s) => names[s]).join('、')} 已經吃碰很多組，可能快聽牌了，危險牌（生張、中張）要小心打。` : '';
    if (c.claim && rec) return `建議：${actionText(rec)}。${rec.type === 'pass' ? '吃碰之後牌型沒有變好，先過比較划算。' : rec.type === 'hu' ? '可以胡了，快喊「到」！' : '這樣可以讓手牌更接近聽牌。'}${warn}`;
    if (!c.myTurn) return `現在還沒輪到您。目前您${ana.shanten === 0 ? '已經聽牌' : `還差 ${ana.shanten} 步聽牌`}。${warn}`;
    const best = ana.ranked[0];
    if (!best) return '目前沒有可以分析的打法。';
    const alts = ana.ranked.slice(1, 3).map((x) => typeName(x.t)).join('、');
    return `建議${describeCand(best)}。${alts ? `\n其他可以考慮：${alts}。` : ''}${warn}\n（手牌中淡綠色的那張就是建議打出的牌）`;
  }
}

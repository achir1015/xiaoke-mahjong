// 台灣 16 張麻將規則引擎：一局（Hand）與整場（Match）
// 房主（或單機）持有完整狀態；每位玩家看到的是 view(seat) 遮蔽過的畫面，並以 act(seat, action) 行動。
import { tileType, isFlowerType, typeName, FLOWER0, WIND_NAMES } from './tiles.js';
import { shanten, countsOf, waits } from './hand.js';
import { scoreHand, settle } from './scoring.js';

export const SEAT_DIR = ['東', '南', '西', '北'];
export const DEAD_WALL = 16; // 留 16 張（8 墩）不摸

// 可重現的亂數
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byType = (a, b) => tileType(a) - tileType(b) || a - b;
const types = (ids) => ids.map(tileType);

export class Hand {
  // opts：{ seed, dealer, roundWind, streak, base, perTai }
  constructor(opts) {
    this.seed = opts.seed >>> 0;
    this.dealer = opts.dealer;
    this.roundWind = opts.roundWind;
    this.streak = opts.streak || 0;
    this.base = opts.base ?? 50;
    this.perTai = opts.perTai ?? 20;
    const r = rng(this.seed);
    const wall = Array.from({ length: 144 }, (_, i) => i);
    for (let i = wall.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [wall[i], wall[j]] = [wall[j], wall[i]]; }
    this.wall = wall;
    this.dice = [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6)];
    this.p = [0, 1, 2, 3].map(() => ({ hand: [], melds: [], flowers: [], river: [], drawn: -1, furiten: false, discards: 0 }));
    this.turn = this.dealer;
    this.phase = 'deal';
    this.claims = null;      // 等待其他家回應：{ tile, from, kind:'discard'|'rob', opts:{seat:[actions]}, resp:{seat:action} }
    this.lastDiscard = null; // { seat, tile }
    this.result = null;
    this.events = [];        // 本局事件（畫面、音效用）
    this.log = [];           // 行動紀錄（重播用）
    this.firstRound = true;  // 還沒有人吃碰槓、每家第一巡
    this.afterKong = false;
    this.deal();
  }

  seatWind(s) { return (s - this.dealer + 4) % 4; }
  get remaining() { return Math.max(0, this.wall.length - DEAD_WALL); }

  ev(e) { this.events.push({ ...e, n: this.events.length }); }

  // ---------------- 發牌與補花 ----------------
  deal() {
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 4; i++) {
        const s = (this.dealer + i) % 4;
        for (let j = 0; j < 4; j++) this.p[s].hand.push(this.wall.shift());
      }
    }
    // 莊家多一張（開門）
    this.p[this.dealer].hand.push(this.wall.shift());
    this.p[this.dealer].drawn = this.p[this.dealer].hand[16];
    this.ev({ e: 'deal' });
    // 從莊家開始依序補花
    for (let i = 0; i < 4 && !this.result; i++) this.replaceFlowers((this.dealer + i) % 4, true);
    for (const pl of this.p) pl.hand.sort(byType);
    if (this.result) return;
    this.phase = 'act';
    this.turn = this.dealer;
    this.ev({ e: 'turn', seat: this.turn });
  }

  // 把手上的花亮出並從牌尾補牌；回傳最後補到的牌
  replaceFlowers(s, initial = false) {
    const pl = this.p[s];
    let last = -1;
    for (;;) {
      const i = pl.hand.findIndex((id) => isFlowerType(tileType(id)));
      if (i < 0) break;
      const f = pl.hand.splice(i, 1)[0];
      pl.flowers.push(f);
      this.ev({ e: 'flower', seat: s, tile: f, initial });
      if (this.checkFlowerWin(s)) return -1;
      if (!this.wall.length) break;
      last = this.wall.pop();
      pl.hand.push(last);
      if (pl.drawn >= 0 && tileType(pl.drawn) === tileType(f) && pl.drawn === f) pl.drawn = last;
    }
    return last;
  }

  // 八仙過海、七搶一
  checkFlowerWin(s) {
    const n = this.p[s].flowers.length;
    if (n === 8) { this.finishWin(s, { flowerWin: 'baxian', selfDraw: true }); return true; }
    if (n === 7) {
      const other = [0, 1, 2, 3].find((o) => o !== s && this.p[o].flowers.length === 1);
      if (other != null) {
        // 搶走第八張花
        const f = this.p[other].flowers.pop();
        this.p[s].flowers.push(f);
        this.ev({ e: 'rob-flower', seat: s, from: other, tile: f });
        this.finishWin(s, { flowerWin: 'qiqiangyi', selfDraw: false, from: other });
        return true;
      }
    }
    // 自己 7 張、別人剛好拿到第 8 張
    if (n === 1) {
      const seven = [0, 1, 2, 3].find((o) => o !== s && this.p[o].flowers.length === 7);
      if (seven != null) {
        const f = this.p[s].flowers.pop();
        this.p[seven].flowers.push(f);
        this.ev({ e: 'rob-flower', seat: seven, from: s, tile: f });
        this.finishWin(seven, { flowerWin: 'qiqiangyi', selfDraw: false, from: s });
        return true;
      }
    }
    return false;
  }

  // ---------------- 摸牌 ----------------
  draw(s, fromBack = false) {
    if (this.remaining <= 0) { this.finishDraw(); return false; }
    const pl = this.p[s];
    const id = fromBack ? this.wall.pop() : this.wall.shift();
    pl.hand.push(id);
    pl.drawn = id;
    pl.furiten = false;
    this.ev({ e: 'draw', seat: s, back: fromBack });
    if (isFlowerType(tileType(id))) {
      this.replaceFlowers(s);
      if (this.result) return false;
      if (this.remaining < 0) { this.finishDraw(); return false; }
    }
    this.turn = s;
    this.phase = 'act';
    this.ev({ e: 'turn', seat: s });
    return true;
  }

  // ---------------- 可以做的動作 ----------------
  need(s) { return 5 - this.p[s].melds.length; }
  concealedTypes(s) { return types(this.p[s].hand); }

  canWinWith(s, t) {
    const c = countsOf(this.concealedTypes(s));
    c[t]++;
    return shanten(c, this.need(s)) === -1;
  }

  options(s) {
    if (this.result) return [];
    if (this.phase === 'act' && this.turn === s) {
      const pl = this.p[s];
      const out = [];
      const c = countsOf(this.concealedTypes(s));
      if (pl.drawn >= 0 && shanten(c, this.need(s)) === -1) out.push({ type: 'tsumo' });
      if (this.remaining > 0) {
        for (let t = 0; t < 34; t++) if (c[t] === 4) out.push({ type: 'ankan', t });
        for (const m of pl.melds) if (m.kind === 'pung' && c[m.t] >= 1) out.push({ type: 'kakan', t: m.t });
      }
      for (const t of new Set(this.concealedTypes(s))) out.push({ type: 'discard', t });
      return out;
    }
    if ((this.phase === 'claim' || this.phase === 'rob') && this.claims && this.claims.opts[s] && !(s in this.claims.resp)) return this.claims.opts[s];
    return [];
  }

  // 打出後其他家可以做的動作
  claimOptions(s, t, from, kind) {
    const out = [];
    const pl = this.p[s];
    if (!pl.furiten && this.canWinWith(s, t)) out.push({ type: 'hu' });
    if (kind === 'discard' && this.remaining > 0) {
      const c = countsOf(this.concealedTypes(s));
      if (c[t] >= 2) out.push({ type: 'pon' });
      if (c[t] >= 3) out.push({ type: 'kan' });
      if ((from + 1) % 4 === s && t < 27) {
        const r = t % 9;
        for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
          if (r + a < 0 || r + b > 8) continue;
          if (c[t + a] && c[t + b]) out.push({ type: 'chi', use: [t + a, t + b] });
        }
      }
    }
    if (out.length) out.push({ type: 'pass' });
    return out;
  }

  // ---------------- 行動 ----------------
  act(s, a) {
    if (this.result) throw new Error('本局已結束');
    const legal = this.options(s);
    const ok = legal.some((o) => o.type === a.type && (o.t == null || o.t === a.t) && (!o.use || (a.use && o.use[0] === a.use[0] && o.use[1] === a.use[1])));
    if (!ok) throw new Error('現在不能這樣做');
    this.log.push([s, a.type, a.t ?? (a.use ? a.use.join(',') : null)]);
    if (this.phase === 'act') return this.actTurn(s, a);
    return this.respond(s, a);
  }

  actTurn(s, a) {
    const pl = this.p[s];
    if (a.type === 'tsumo') {
      this.finishWin(s, { selfDraw: true, winTile: tileType(pl.drawn >= 0 ? pl.drawn : pl.hand[pl.hand.length - 1]) });
      return;
    }
    if (a.type === 'discard') {
      // 優先打出同種牌中剛摸到的那張以外的（畫面上看起來自然）
      let idx = pl.hand.findIndex((id) => tileType(id) === a.t && id !== pl.drawn);
      if (idx < 0) idx = pl.hand.findIndex((id) => tileType(id) === a.t);
      const id = pl.hand.splice(idx, 1)[0];
      pl.hand.sort(byType);
      pl.drawn = -1;
      pl.river.push(id);
      pl.discards++;
      this.afterKong = false;
      this.lastDiscard = { seat: s, tile: id };
      this.ev({ e: 'discard', seat: s, tile: id });
      this.openClaims(id, s, 'discard');
      return;
    }
    if (a.type === 'ankan') {
      const ids = pl.hand.filter((id) => tileType(id) === a.t);
      pl.hand = pl.hand.filter((id) => tileType(id) !== a.t);
      pl.melds.push({ kind: 'kong', t: a.t, tiles: ids, concealed: true });
      pl.drawn = -1;
      this.ev({ e: 'ankan', seat: s, t: a.t });
      this.firstRound = false;
      this.afterKong = true;
      this.draw(s, true);
      return;
    }
    if (a.type === 'kakan') {
      // 加槓：先給別人搶槓
      const idx = pl.hand.findIndex((id) => tileType(id) === a.t);
      const id = pl.hand.splice(idx, 1)[0];
      pl.drawn = -1;
      const m = pl.melds.find((x) => x.kind === 'pung' && x.t === a.t);
      m.kind = 'kong';
      m.tiles.push(id);
      m.added = true;
      this.ev({ e: 'kakan', seat: s, t: a.t, tile: id });
      this.firstRound = false;
      this.openClaims(id, s, 'rob');
    }
  }

  openClaims(id, from, kind) {
    const t = tileType(id);
    const opts = {};
    let any = false;
    for (let k = 1; k < 4; k++) {
      const s = (from + k) % 4;
      const o = this.claimOptions(s, t, from, kind);
      if (o.length) { opts[s] = o; any = true; }
    }
    if (!any) { this.afterClaims(id, from, kind); return; }
    this.phase = kind === 'rob' ? 'rob' : 'claim';
    this.claims = { tile: id, t, from, kind, opts, resp: {} };
    this.ev({ e: 'claim-open', from, tile: id, kind, seats: Object.keys(opts).map(Number) });
  }

  respond(s, a) {
    const c = this.claims;
    c.resp[s] = a;
    // 放棄胡牌：過水，摸牌前不能再胡
    if (a.type !== 'hu' && c.opts[s].some((o) => o.type === 'hu')) this.p[s].furiten = true;
    this.resolveClaims();
  }

  // 依優先順序決定：胡 > 碰／槓 > 吃。較高優先的人還沒回應就先等
  resolveClaims() {
    const c = this.claims;
    const order = [1, 2, 3].map((k) => (c.from + k) % 4).filter((s) => c.opts[s]);
    const wants = (s, type) => c.resp[s] && c.resp[s].type === type;
    const may = (s, type) => !(s in c.resp) && c.opts[s].some((o) => o.type === type);
    // 胡：依座位順序最近的人優先（截胡）
    for (const s of order) {
      if (wants(s, 'hu')) { this.ronBy(s); return; }
      if (may(s, 'hu')) return; // 等他決定
    }
    for (const s of order) {
      if (wants(s, 'pon') || wants(s, 'kan')) { this.claimSet(s, c.resp[s]); return; }
      if (may(s, 'pon') || may(s, 'kan')) return;
    }
    for (const s of order) {
      if (wants(s, 'chi')) { this.claimSet(s, c.resp[s]); return; }
      if (may(s, 'chi')) return;
    }
    // 大家都過
    const { tile, from, kind } = c;
    this.claims = null;
    this.ev({ e: 'claim-close' });
    this.afterClaims(tile, from, kind);
  }

  afterClaims(id, from, kind) {
    if (kind === 'rob') {
      // 沒人搶槓：加槓者補牌
      this.afterKong = true;
      this.draw(from, true);
      return;
    }
    // 下一家摸牌；整圈過後就不是第一巡了
    const next = (from + 1) % 4;
    if (this.p.every((pl) => pl.discards >= 1)) this.firstRound = false;
    this.draw(next);
  }

  ronBy(s) {
    const c = this.claims;
    this.claims = null;
    const fromP = this.p[c.from];
    if (c.kind === 'discard') fromP.river.pop();
    else {
      // 搶槓：把加槓還原成碰
      const m = fromP.melds.find((x) => x.kind === 'kong' && x.t === c.t && x.added);
      m.kind = 'pung'; m.tiles = m.tiles.filter((id) => id !== c.tile); delete m.added;
    }
    this.p[s].hand.push(c.tile);
    this.p[s].drawn = c.tile;
    const renhu = c.kind === 'discard' && this.firstRound && c.from === this.dealer && fromP.discards === 1 && this.p.every((pl) => !pl.melds.length);
    this.finishWin(s, { selfDraw: false, from: c.from, winTile: c.t, robKong: c.kind === 'rob', renhu, last: this.remaining <= 0 });
  }

  claimSet(s, a) {
    const c = this.claims;
    this.claims = null;
    const pl = this.p[s];
    this.p[c.from].river.pop();
    const take = (t, n) => {
      const got = [];
      for (let k = 0; k < n; k++) { const i = pl.hand.findIndex((id) => tileType(id) === t); got.push(pl.hand.splice(i, 1)[0]); }
      return got;
    };
    let meld;
    if (a.type === 'chi') {
      const ids = [take(a.use[0], 1)[0], take(a.use[1], 1)[0], c.tile];
      const lo = Math.min(c.t, ...a.use);
      meld = { kind: 'chow', t: lo, tiles: ids.sort(byType), from: c.from, claimed: c.tile };
    } else if (a.type === 'pon') meld = { kind: 'pung', t: c.t, tiles: [...take(c.t, 2), c.tile], from: c.from, claimed: c.tile };
    else meld = { kind: 'kong', t: c.t, tiles: [...take(c.t, 3), c.tile], from: c.from, claimed: c.tile };
    pl.melds.push(meld);
    this.firstRound = false;
    this.lastDiscard = null;
    this.ev({ e: a.type, seat: s, from: c.from, t: c.t, tile: c.tile, use: a.use });
    if (a.type === 'kan') { this.afterKong = true; this.draw(s, true); return; }
    this.turn = s;
    this.phase = 'act';
    pl.drawn = -1;
    this.ev({ e: 'turn', seat: s });
  }

  // ---------------- 結束 ----------------
  finishWin(s, w) {
    const pl = this.p[s];
    const winTile = w.winTile ?? (pl.drawn >= 0 ? tileType(pl.drawn) : -1);
    const tianhu = !w.flowerWin && w.selfDraw && s === this.dealer && this.firstRound && pl.discards === 0 && this.p.every((x) => !x.melds.length);
    const dihu = !w.flowerWin && w.selfDraw && s !== this.dealer && this.firstRound && pl.discards === 0 && this.p.every((x) => !x.melds.length);
    const score = scoreHand({
      concealed: this.concealedTypes(s),
      melds: pl.melds.map((m) => ({ kind: m.kind, t: m.t, concealed: !!m.concealed })),
      flowers: types(pl.flowers),
      winTile,
      selfDraw: !!w.selfDraw,
      seatWind: this.seatWind(s),
      roundWind: this.roundWind,
      last: w.last ?? (w.selfDraw && this.remaining <= 0),
      afterKong: w.selfDraw && this.afterKong,
      robKong: !!w.robKong,
      tianhu, dihu, renhu: !!w.renhu,
      flowerWin: w.flowerWin,
    });
    const payers = w.selfDraw ? [0, 1, 2, 3].filter((x) => x !== s) : [w.from];
    const money = settle({ winner: s, payers, tai: score.total, dealer: this.dealer, streak: this.streak, base: this.base, perTai: this.perTai });
    this.result = { type: 'win', winner: s, from: w.selfDraw ? -1 : w.from, selfDraw: !!w.selfDraw, winTile, score, ...money, flowerWin: w.flowerWin || null };
    this.phase = 'over';
    this.claims = null;
    this.ev({ e: 'win', seat: s, from: this.result.from, selfDraw: !!w.selfDraw, t: winTile, flowerWin: w.flowerWin || null });
  }

  finishDraw() {
    this.result = { type: 'draw', deltas: [0, 0, 0, 0] };
    this.phase = 'over';
    this.claims = null;
    this.ev({ e: 'exhaust' });
  }

  // ---------------- 畫面資料 ----------------
  // seat：-1＝觀戰（看不到任何人的手牌）、'all'＝全部公開（重播、結束後）
  view(seat) {
    const open = seat === 'all' || !!this.result;
    return {
      dealer: this.dealer,
      roundWind: this.roundWind,
      streak: this.streak,
      remaining: this.remaining,
      wallLen: this.wall.length,
      dice: this.dice,
      turn: this.turn,
      phase: this.phase,
      players: this.p.map((pl, s) => ({
        hand: open || s === seat ? pl.hand.slice() : null,
        count: pl.hand.length,
        drawn: open || s === seat ? pl.drawn : (pl.drawn >= 0 ? 1 : -1),
        melds: pl.melds.map((m) => ({ kind: m.kind, t: m.t, tiles: m.concealed && !(open || s === seat) ? [-1, -1, -1, -1] : m.tiles.slice(), concealed: !!m.concealed, from: m.from, claimed: m.claimed })),
        flowers: pl.flowers.slice(),
        river: pl.river.slice(),
        seatWind: this.seatWind(s),
      })),
      lastDiscard: this.lastDiscard,
      claim: this.claims ? { tile: this.claims.tile, from: this.claims.from, kind: this.claims.kind, waiting: Object.keys(this.claims.opts).map(Number).filter((x) => !(x in this.claims.resp)) } : null,
      result: this.result,
      evN: this.events.length,
    };
  }

  // 某位玩家聽什麼牌（自己的畫面用）
  waitsOf(s) {
    const c = countsOf(this.concealedTypes(s));
    return waits(c, this.need(s));
  }
}

// ---------------- 整場：圈風、輪莊、連莊、點數 ----------------
export const MATCH_LENGTHS = [
  ['hand1', '打一局'],
  ['round1', '一圈（東風圈）'],
  ['round2', '半將（東南圈）'],
  ['round4', '一將（四圈）'],
];

export class Match {
  // cfg：{ length, base, perTai, start, seed }
  constructor(cfg) {
    this.cfg = { length: 'round1', base: 50, perTai: 20, start: 2000, ...cfg };
    this.seed = (cfg.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
    this.r = rng(this.seed);
    this.firstDealer = Math.floor(this.r() * 4);
    this.dealer = this.firstDealer;
    this.roundWind = 0;
    this.streak = 0;
    this.handNo = 0;          // 第幾手（從 1 開始）
    this.dealerTurns = 0;     // 本圈已輪過幾位莊家
    this.scores = [0, 1, 2, 3].map(() => this.cfg.start);
    this.history = [];
    this.hand = null;
    this.over = false;
  }

  get rounds() { return { hand1: 0, round1: 1, round2: 2, round4: 4 }[this.cfg.length] ?? 1; }

  nextHand() {
    if (this.over) return null;
    this.handNo++;
    this.hand = new Hand({ seed: Math.floor(this.r() * 2 ** 31), dealer: this.dealer, roundWind: this.roundWind, streak: this.streak, base: this.cfg.base, perTai: this.cfg.perTai });
    return this.hand;
  }

  // 一局結束後結算、決定下一局的莊家
  endHand() {
    const h = this.hand;
    if (!h || !h.result || h.settled) return;
    h.settled = true;
    const res = h.result;
    for (let s = 0; s < 4; s++) this.scores[s] += res.deltas[s];
    this.history.push({
      no: this.handNo, roundWind: h.roundWind, dealer: h.dealer, streak: h.streak, seed: h.seed,
      result: res.type === 'win' ? { type: 'win', winner: res.winner, from: res.from, selfDraw: res.selfDraw, tai: res.score.total, items: res.score.items, winTile: res.winTile, flowerWin: res.flowerWin } : { type: 'draw' },
      deltas: res.deltas.slice(), scores: this.scores.slice(), log: h.log.slice(),
    });
    // 連莊：莊家胡牌或流局
    const keep = res.type === 'draw' || res.winner === h.dealer;
    if (keep) this.streak++;
    else {
      this.streak = 0;
      this.dealer = (this.dealer + 1) % 4;
      this.dealerTurns++;
      if (this.dealerTurns >= 4) { this.dealerTurns = 0; this.roundWind++; }
    }
    if (this.rounds === 0 || this.roundWind >= this.rounds) this.over = true;
  }

  ranking() {
    return [0, 1, 2, 3].sort((a, b) => this.scores[b] - this.scores[a]);
  }

  label() {
    const h = this.hand;
    if (!h) return '';
    return `${WIND_NAMES[h.roundWind]}風圈．${SEAT_DIR[(h.dealer - this.firstDealer + 4) % 4]}局${h.streak ? `．連${h.streak}` : ''}`;
  }
}

// 依紀錄重播一局：meta＝{ seed, dealer, roundWind, streak, base, perTai }，log＝[[座位, 動作, 參數]]
export function decodeAction([, type, arg]) {
  if (type === 'chi') return { type, use: String(arg).split(',').map(Number) };
  return arg == null ? { type } : { type, t: Number(arg) };
}
export function replayHand(meta, log, steps = Infinity, onStep = null) {
  const h = new Hand(meta);
  for (let i = 0; i < log.length && i < steps && !h.result; i++) {
    if (onStep) onStep(h, log[i], i);
    h.act(log[i][0], decodeAction(log[i]));
  }
  return h;
}

export { typeName, FLOWER0 };

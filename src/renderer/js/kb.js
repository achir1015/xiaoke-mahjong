// 麻將智庫：把每一局的牌譜存起來，統計「什麼牌容易放槍」「吃碰之後贏的機會」「常見台型」，讓 AI 參考
import { tileType, typeName } from './tiles.js';
import { replayHand } from './rules.js';
import { perceive, threatOf, dangerKey } from './ai.js';
import { shanten } from './hand.js';

export const KB_VERSION = 1;
const MIN_SAMPLES = 30;

export class KnowledgeBase {
  constructor(data) {
    const d = data && data.v === KB_VERSION ? data : {};
    this.hands = d.hands || 0;          // 學過幾局
    this.learned = new Set(d.learned || []); // 已學過的局（避免重複）
    this.danger = d.danger || {};       // key → [打出次數, 被胡次數]
    this.calls = d.calls || {};         // 'pon|2' → [次數, 結果總和]（胡 +1、放槍 -1）
    this.tai = d.tai || {};             // 台型名稱 → 出現次數
    this.wins = d.wins || { self: 0, ron: 0, draw: 0, flower: 0 };
    this.taiSum = d.taiSum || 0;
  }

  toJSON() {
    return { v: KB_VERSION, hands: this.hands, learned: [...this.learned].slice(-5000), danger: this.danger, calls: this.calls, tai: this.tai, wins: this.wins, taiSum: this.taiSum };
  }

  // 學到的放槍率（樣本不足回傳 null）
  dangerRate(key) {
    const r = this.danger[key];
    if (!r || r[0] < MIN_SAMPLES) return null;
    return (r[1] + 0.5) / (r[0] + 10);
  }

  // 吃碰的傾向：比起「過」平均結果好多少（樣本不足回傳 0）
  callBias(type, sh) {
    const b = Math.min(3, sh);
    const a = this.calls[`${type}|${b}`], p = this.calls[`pass|${b}`];
    if (!a || !p || a[0] < MIN_SAMPLES || p[0] < MIN_SAMPLES) return 0;
    return Math.max(-0.4, Math.min(0.4, (a[1] / a[0] - p[1] / p[0]) * 3));
  }

  // 學一局：meta 同 replayHand；id 用來避免重複學
  learnHand(meta, log, id) {
    if (id && this.learned.has(id)) return false;
    const samples = [];     // [key, discarder, tile, opponent]
    const calls = [];       // [seat, type, shanten]
    let h;
    try {
      h = replayHand(meta, log, Infinity, (hand, [s, type, arg]) => {
        if (type === 'discard') {
          const t = Number(arg);
          const view = hand.view(s);
          const info = perceive(view, s);
          for (let o = 0; o < 4; o++) {
            if (o === s) continue;
            const g = view.players[o].river.some((x) => tileType(x) === t);
            samples.push([dangerKey(t, info.seen[t], g, threatOf(view, o)), s, t, o, hand.p[s].discards]);
          }
        } else if (hand.claims && hand.claims.opts[s] && hand.claims.opts[s].some((x) => x.type === 'pon' || x.type === 'chi')) {
          const info = perceive(hand.view(s), s);
          calls.push([s, type === 'chi' || type === 'pon' || type === 'kan' ? (type === 'kan' ? 'pon' : type) : 'pass', shanten(info.counts, info.need)]);
        }
      });
    } catch (e) { console.warn('智庫：牌譜無法重播', e); return false; }
    const r = h.result;
    if (!r) return false;
    // 放槍統計：最後一張被胡的打牌
    const robbed = r.type === 'win' && r.score.items.some((it) => it.key === 'qianggang');
    const ronIdx = r.type === 'win' && !r.selfDraw && !r.flowerWin && !robbed && r.from >= 0 ? samples.reduce((k, x, i) => (x[1] === r.from ? i : k), -1) : -1;
    const lastDiscardN = ronIdx >= 0 ? samples[ronIdx][4] : -1;
    for (const [key, s, , o, n] of samples) {
      const rec = (this.danger[key] ||= [0, 0]);
      rec[0]++;
      if (r.type === 'win' && !r.selfDraw && s === r.from && o === r.winner && n === lastDiscardN) rec[1]++;
    }
    const outcome = (s) => (r.type !== 'win' ? 0 : r.winner === s ? 1 : !r.selfDraw && r.from === s ? -1 : 0);
    for (const [s, type, sh] of calls) {
      const rec = (this.calls[`${type}|${Math.min(3, sh)}`] ||= [0, 0]);
      rec[0]++; rec[1] += outcome(s);
    }
    if (r.type === 'win') {
      if (r.flowerWin) this.wins.flower++;
      else if (r.selfDraw) this.wins.self++;
      else this.wins.ron++;
      this.taiSum += r.score.total;
      for (const it of r.score.items) { const k = it.name.replace(/（.*）/, ''); this.tai[k] = (this.tai[k] || 0) + 1; }
    } else this.wins.draw++;
    this.hands++;
    if (id) this.learned.add(id);
    return true;
  }

  // 一場（多局）的紀錄
  learnMatch(rec) {
    let n = 0;
    for (const hd of rec.history || []) {
      const meta = { seed: hd.seed, dealer: hd.dealer, roundWind: hd.roundWind, streak: hd.streak, base: rec.cfg?.base ?? 50, perTai: rec.cfg?.perTai ?? 20 };
      if (this.learnHand(meta, hd.log || [], `${rec.id}#${hd.no}`)) n++;
    }
    return n;
  }

  // 給畫面顯示的摘要
  summary() {
    const total = this.hands || 0;
    const wins = this.wins;
    const taiTop = Object.entries(this.tai).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const cls = { z: '字牌', t: '么九（1、9）', e: '2、8', m: '中張（3～7）' };
    const dangerRows = Object.entries(this.danger)
      .filter(([, v]) => v[0] >= 20)
      .map(([k, v]) => ({ k, label: `${cls[k[0]]}．場上已見 ${k[1]} 張${k.includes('g') ? '．現物' : ''}．對手威脅 ${['低', '中', '高'][Number(k[k.length - 1])]}`, n: v[0], rate: v[1] / v[0] }))
      .sort((a, b) => b.rate - a.rate);
    const callRows = Object.entries(this.calls).map(([k, v]) => {
      const [type, sh] = k.split('|');
      return { label: `${{ pon: '碰', chi: '吃', pass: '不吃不碰' }[type] || type}（當時 ${sh === '3' ? '3 以上' : sh} 向聽）`, n: v[0], avg: v[1] / v[0] };
    }).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));
    return { total, wins, avgTai: wins.self + wins.ron + wins.flower ? this.taiSum / (wins.self + wins.ron + wins.flower) : 0, taiTop, dangerRows, callRows };
  }
}

export const tileLabel = (id) => typeName(tileType(id));

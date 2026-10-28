// 小柯 AI：以向聽數＋有效進張為主，高段位加上牌值與防守，並參考「麻將智庫」學到的經驗
// 只看自己的 view（看不到別人的手牌），不作弊
import { tileType, isHonor, isDragon, typeName } from './tiles.js';
import { shanten, countsOf, ukeire, waits } from './hand.js';

export const LEVELS = [
  { name: '入門', noise: 0.4 },
  { name: '普通', noise: 0.15 },
  { name: '高手', noise: 0 },
  { name: '大師', noise: 0 },
];

// 從畫面資料整理出 AI 需要的資訊
export function perceive(view, seat) {
  const me = view.players[seat];
  const hand = me.hand.map(tileType);
  const counts = countsOf(hand);
  const need = 5 - me.melds.length;
  const seen = new Array(34).fill(0);
  for (const t of hand) seen[t]++;
  for (const pl of view.players) {
    for (const id of pl.river) seen[tileType(id)]++;
    for (const m of pl.melds) for (const id of m.tiles) if (id >= 0) seen[tileType(id)]++;
  }
  const remain = seen.map((n) => Math.max(0, 4 - n));
  return { me, hand, counts, need, seen, remain, seat, view };
}

// 對手威脅度：0 安全～2 很可能聽牌
export function threatOf(view, s) {
  const pl = view.players[s];
  const open = pl.melds.filter((m) => !m.concealed).length;
  const late = view.remaining < 28;
  if (open >= 3 || (open >= 2 && late)) return 2;
  if (open >= 2 || (late && pl.river.length >= 10)) return 1;
  return 0;
}

// 智庫特徵鍵：牌型類別 × 場上已見張數 × 是否現物 × 威脅度
export function dangerKey(t, seenN, genbutsu, threat) {
  const cls = isHonor(t) ? 'z' : [1, 9].includes((t % 9) + 1) ? 't' : [2, 8].includes((t % 9) + 1) ? 'e' : 'm';
  return `${cls}${Math.min(3, seenN)}${genbutsu ? 'g' : ''}${threat}`;
}

// 一張牌打出去的危險度（0～1）
export function dangerOf(info, t, kb) {
  const { view, seat, seen } = info;
  let worst = 0;
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const th = threatOf(view, s);
    const genbutsu = view.players[s].river.some((id) => tileType(id) === t);
    let d;
    const learned = kb && kb.dangerRate(dangerKey(t, seen[t], genbutsu, th));
    if (learned != null) d = learned;
    else {
      if (genbutsu) d = 0.01;
      else if (isHonor(t)) d = [0.06, 0.04, 0.015, 0.003][Math.min(3, seen[t])];
      else {
        const r = (t % 9) + 1;
        d = (r === 1 || r === 9 ? 0.05 : r === 2 || r === 8 ? 0.07 : 0.09) * [1, 0.85, 0.55, 0.2][Math.min(3, seen[t])];
      }
      d *= [0.5, 1, 1.8][th];
    }
    worst = Math.max(worst, d * (th + 0.4));
  }
  return worst;
}

// 牌的價值：孤張字牌、么九先打
function keepValue(info, t) {
  const { counts, view, seat } = info;
  const n = counts[t];
  if (isHonor(t)) {
    const yakuhai = isDragon(t) || t - 27 === view.players[seat].seatWind || t - 27 === view.roundWind;
    if (n >= 2) return yakuhai ? 3 : 1.5;
    return yakuhai ? 0.6 : 0.1;
  }
  const r = t % 9;
  let v = r === 0 || r === 8 ? 0.4 : r === 1 || r === 7 ? 0.7 : 1;
  // 有鄰近牌的較有用
  const near = (d) => (r + d >= 0 && r + d <= 8 ? counts[t + d] : 0);
  v += 0.5 * (near(-1) + near(1)) + 0.25 * (near(-2) + near(2));
  return v;
}

// 列出所有可打的牌與評估（軍師也會用）
export function rankDiscards(info, level = 3, kb = null) {
  const { counts, need, remain } = info;
  const cands = [];
  const defend = level >= 3;
  let maxThreat = 0;
  for (let s = 0; s < 4; s++) if (s !== info.seat) maxThreat = Math.max(maxThreat, threatOf(info.view, s));
  for (let t = 0; t < 34; t++) {
    if (!counts[t]) continue;
    counts[t]--;
    const sh = shanten(counts, need);
    const uk = level >= 2 || sh <= 0 ? ukeire(counts, need, remain) : { n: 0, tiles: [] };
    const w = sh === 0 ? waits(counts, need).map((x) => ({ t: x, left: remain[x] })) : [];
    counts[t]++;
    const danger = dangerOf(info, t, kb);
    let score = -sh * 100 + (level >= 2 ? uk.n * 1.2 : 0) - keepValue(info, t) * (level >= 1 ? 2 : 0);
    if (sh === 0) score += w.reduce((a, x) => a + x.left, 0) * 2; // 聽越多張越好
    if (defend) {
      // 威脅越大、自己離聽牌越遠，越重視安全
      const mySh = sh;
      const weight = maxThreat === 2 && mySh >= 2 && info.view.remaining < 40 ? 100 : 0;
      score -= danger * weight;
    }
    cands.push({ t, shanten: sh, ukeire: uk.n, ukTiles: uk.tiles, waits: w, danger, score });
  }
  cands.sort((a, b) => b.score - a.score);
  return cands;
}

// 吃碰之後的最佳向聽數
function bestAfterCall(counts, need, removeTypes) {
  const c = counts.slice();
  for (const t of removeTypes) c[t]--;
  let best = 99;
  for (let t = 0; t < 34; t++) {
    if (!c[t]) continue;
    c[t]--;
    best = Math.min(best, shanten(c, need - 1));
    c[t]++;
  }
  return best;
}

// 主要決策：opts 是可做的動作；回傳其中一個
export function decide(view, seat, opts, level = 2, kb = null, rand = Math.random) {
  const info = perceive(view, seat);
  const { counts, need } = info;
  const has = (type) => opts.find((o) => o.type === type);
  const lv = LEVELS[Math.max(0, Math.min(3, level))];

  // 輪到自己
  if (has('discard') || has('tsumo')) {
    if (has('tsumo')) return has('tsumo');
    const cur = shanten(counts, need);
    // 暗槓／加槓：不影響聽牌就槓
    for (const o of opts.filter((x) => x.type === 'ankan' || x.type === 'kakan')) {
      const c = counts.slice();
      c[o.t] -= o.type === 'ankan' ? 4 : 1;
      const after = shanten(c, o.type === 'ankan' ? need - 1 : need);
      const best = Math.min(...rankDiscards(info, 1).map((x) => x.shanten));
      if (after <= best && (level >= 1 || rand() < 0.5)) return o;
    }
    const ranked = rankDiscards(info, level, kb);
    let pick = ranked[0];
    if (lv.noise && rand() < lv.noise) {
      const pool = ranked.filter((x) => x.shanten <= ranked[0].shanten + (level === 0 ? 1 : 0));
      pick = pool[Math.floor(rand() * pool.length)] || pick;
    }
    void cur;
    return { type: 'discard', t: pick.t };
  }

  // 回應別人打的牌
  if (has('hu')) return has('hu');
  const t = view.claim ? tileType(view.claim.tile) : -1;
  if (t < 0) return has('pass') || opts[0];
  const cur = shanten(counts, need);
  const yakuhai = isDragon(t) || t - 27 === view.players[seat].seatWind || t - 27 === view.roundWind;
  let best = null, bestGain = 0;
  for (const o of opts) {
    let after, gain;
    if (o.type === 'kan') {
      const c = counts.slice(); c[t] -= 3;
      after = shanten(c, need - 1);
      gain = cur - after + 0.3;
    } else if (o.type === 'pon') {
      after = bestAfterCall(counts, need, [t, t]);
      gain = cur - after + (yakuhai ? 0.6 : 0);
    } else if (o.type === 'chi') {
      after = bestAfterCall(counts, need, o.use);
      gain = cur - after - (level >= 2 && !view.players[seat].melds.some((m) => !m.concealed) ? 0.3 : 0);
    } else continue;
    // 智庫：這類吃碰在過去的勝率
    if (kb && level >= 2) gain += kb.callBias(o.type, cur) || 0;
    if (level === 0) gain += rand() - 0.5;
    if (gain > bestGain) { bestGain = gain; best = o; }
  }
  if (best && bestGain >= 0.5) return best;
  return has('pass') || opts[0];
}

// 給軍師用的分析文字資料
export function analyze(view, seat, kb = null) {
  const info = perceive(view, seat);
  const sh = shanten(info.counts, info.need);
  const ranked = view.players[seat].hand.length % 3 === 2 ? rankDiscards(info, 3, kb) : [];
  return { shanten: sh, ranked: ranked.slice(0, 4), remain: info.remain, threats: [0, 1, 2, 3].map((s) => (s === seat ? 0 : threatOf(view, s))) };
}

export const describeCand = (c) => {
  const parts = [`打${typeName(c.t)}`];
  if (c.shanten === 0) parts.push(`聽 ${c.waits.map((w) => `${typeName(w.t)}（剩 ${w.left} 張）`).join('、') || '（已無牌可聽）'}`);
  else parts.push(`${c.shanten} 向聽，有效進張 ${c.ukeire} 張`);
  if (c.danger >= 0.08) parts.push('有放槍風險');
  return parts.join('，');
};

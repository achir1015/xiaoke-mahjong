// 手牌分析：向聽數、胡牌拆解、聽哪些牌
// counts：長度 34 的陣列（各牌種張數，不含花牌）；need：還需要幾組面子（5 減去已吃碰槓的組數）
const suitCache = new Map();

// 單一花色（9 種）所有可能的 [面子, 搭子, 雀頭] 組合（只留不被支配的）
function suitOptions(c, honor) {
  const key = (honor ? 'h' : 's') + c.join('');
  let r = suitCache.get(key);
  if (r) return r;
  const out = new Map();
  const a = c.slice();
  const rec = (i, m, t, p) => {
    while (i < a.length && !a[i]) i++;
    if (i >= a.length) { const k = m * 100 + t * 10 + p; out.set(k, [m, t, p]); return; }
    // 刻子
    if (a[i] >= 3) { a[i] -= 3; rec(i, m + 1, t, p); a[i] += 3; }
    // 順子
    if (!honor && i + 2 < 9 && a[i + 1] && a[i + 2]) { a[i]--; a[i + 1]--; a[i + 2]--; rec(i, m + 1, t, p); a[i]++; a[i + 1]++; a[i + 2]++; }
    // 對子（當雀頭或搭子）
    if (a[i] >= 2) {
      a[i] -= 2;
      if (!p) rec(i, m, t, 1);
      rec(i, m, t + 1, p);
      a[i] += 2;
    }
    // 兩面／邊張、嵌張
    if (!honor) {
      if (i + 1 < 9 && a[i + 1]) { a[i]--; a[i + 1]--; rec(i, m, t + 1, p); a[i]++; a[i + 1]++; }
      if (i + 2 < 9 && a[i + 2]) { a[i]--; a[i + 2]--; rec(i, m, t + 1, p); a[i]++; a[i + 2]++; }
    }
    // 孤張
    a[i]--; rec(i, m, t, p); a[i]++;
  };
  rec(0, 0, 0, 0);
  // 去掉被支配的組合
  const arr = [...out.values()];
  r = arr.filter((x) => !arr.some((y) => y !== x && y[0] >= x[0] && y[1] >= x[1] && y[2] >= x[2] && (y[0] > x[0] || y[1] > x[1] || y[2] > x[2])));
  suitCache.set(key, r);
  return r;
}

// 向聽數：-1＝已胡、0＝聽牌
export function shanten(counts, need = 5) {
  const groups = [
    suitOptions(counts.slice(0, 9), false),
    suitOptions(counts.slice(9, 18), false),
    suitOptions(counts.slice(18, 27), false),
    honorOptions(counts),
  ];
  let best = 99;
  for (const g0 of groups[0]) for (const g1 of groups[1]) for (const g2 of groups[2]) for (const g3 of groups[3]) {
    let m = g0[0] + g1[0] + g2[0] + g3[0];
    let t = g0[1] + g1[1] + g2[1] + g3[1];
    const pairs = g0[2] + g1[2] + g2[2] + g3[2];
    if (pairs > 1) t += pairs - 1; // 多的雀頭當搭子
    const p = pairs ? 1 : 0;
    if (m > need) m = need;
    if (m + t > need) t = need - m;
    const s = 2 * (need - m) - t - p;
    if (s < best) best = s;
  }
  return best;
}

function honorOptions(counts) {
  // 字牌只能成刻或對：直接算
  const key = 'H' + counts.slice(27, 34).join('');
  let r = suitCache.get(key);
  if (r) return r;
  const opts = new Map();
  const rec = (i, m, t, p) => {
    if (i >= 34) { opts.set(m * 100 + t * 10 + p, [m, t, p]); return; }
    const n = counts[i];
    if (n >= 3) rec(i + 1, m + 1, t, p);
    if (n >= 2) { if (!p) rec(i + 1, m, t, 1); rec(i + 1, m, t + 1, p); }
    if (n === 4 && !p) rec(i + 1, m + 1, t, 0); // 4 張字牌：一刻＋孤張
    rec(i + 1, m, t, p);
  };
  rec(27, 0, 0, 0);
  const arr = [...opts.values()];
  r = arr.filter((x) => !arr.some((y) => y !== x && y[0] >= x[0] && y[1] >= x[1] && y[2] >= x[2] && (y[0] > x[0] || y[1] > x[1] || y[2] > x[2])));
  suitCache.set(key, r);
  return r;
}

export const countsOf = (types) => { const c = new Array(34).fill(0); for (const t of types) if (t < 34) c[t]++; return c; };
export const isWinCounts = (counts, need) => shanten(counts, need) === -1;

// 胡牌拆解：回傳所有拆法 [{ pair, sets:[{k:'pung'|'chow', t}] }]（chow 的 t 是最小那張）
export function decompose(counts, need) {
  const res = [];
  const a = counts.slice();
  const total = a.reduce((x, y) => x + y, 0);
  if (total !== need * 3 + 2) return res;
  const sets = [];
  const rec = (i) => {
    while (i < 34 && !a[i]) i++;
    if (i >= 34) { res.push({ pair: rec.pair, sets: sets.slice() }); return; }
    if (a[i] >= 3) { a[i] -= 3; sets.push({ k: 'pung', t: i }); rec(i); sets.pop(); a[i] += 3; }
    if (i < 27 && i % 9 <= 6 && a[i + 1] && a[i + 2]) {
      a[i]--; a[i + 1]--; a[i + 2]--; sets.push({ k: 'chow', t: i }); rec(i); sets.pop(); a[i]++; a[i + 1]++; a[i + 2]++;
    }
  };
  for (let p = 0; p < 34; p++) {
    if (a[p] < 2) continue;
    a[p] -= 2;
    rec.pair = p;
    rec(0);
    a[p] += 2;
  }
  return res;
}

// 聽哪些牌（visible：場上看得到的各牌張數，用來扣掉已經沒有的牌；可省略）
export function waits(counts, need, held = null) {
  const out = [];
  if (shanten(counts, need) !== 0) return out;
  for (let t = 0; t < 34; t++) {
    if ((held ? held[t] : counts[t]) >= 4) continue;
    counts[t]++;
    if (shanten(counts, need) === -1) out.push(t);
    counts[t]--;
  }
  return out;
}

// 有效進張：摸到哪些牌會讓向聽數下降；remain[t]＝外面還剩幾張
export function ukeire(counts, need, remain) {
  const s0 = shanten(counts, need);
  let n = 0;
  const tiles = [];
  for (let t = 0; t < 34; t++) {
    if (!remain[t]) continue;
    counts[t]++;
    if (shanten(counts, need) < s0) { n += remain[t]; tiles.push(t); }
    counts[t]--;
  }
  return { n, tiles, shanten: s0 };
}

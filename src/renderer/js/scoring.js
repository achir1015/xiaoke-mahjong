// 台數計算（台灣 16 張麻將常見台數）
import { decompose, countsOf, waits } from './hand.js';
import { isHonor, isDragon, suitOf, FLOWER0, flowerSeat, WIND_NAMES } from './tiles.js';

// 台數表（可在說明裡列出）
export const TAI = {
  dealer: ['莊家', 1, '胡牌者或付錢的一方是莊家，多算 1 台'],
  streak: ['連莊拉莊', 2, '莊家每連一次莊，多算「連一拉一」共 2 台'],
  menqing: ['門清', 1, '沒有吃、碰、明槓，靠別人放槍胡牌'],
  zimo: ['自摸', 1, '自己摸到胡牌的那張'],
  menqingZimo: ['門清自摸', 3, '門清又自摸（取代門清與自摸），俗稱「不求人」'],
  ruleFlower: ['正花', 1, '花牌與自己的門風相同（東：春梅、南：夏蘭、西：秋竹、北：冬菊），每張 1 台'],
  flowerKong: ['花槓', 2, '春夏秋冬或梅蘭竹菊四張到齊'],
  windRound: ['圈風', 1, '有圈風的刻子或槓子'],
  windSeat: ['門風', 1, '有自己門風的刻子或槓子'],
  dragon: ['三元牌', 1, '中、發、白的刻子或槓子，每組 1 台'],
  pinghu: ['平胡', 2, '五組都是順子、沒有字牌和花牌、聽兩面、不是自摸'],
  duting: ['獨聽', 1, '只聽一張牌（邊張、中洞、單吊）'],
  quanqiuren: ['全求人', 2, '五組全部吃碰明槓，單吊別人放槍胡牌'],
  haidi: ['海底撈月', 1, '摸最後一張牌自摸'],
  hedi: ['河底撈魚', 1, '胡最後一張打出的牌'],
  gangshang: ['槓上開花', 1, '槓牌後補的牌自摸'],
  qianggang: ['搶槓', 1, '別人加槓時胡他那張牌'],
  sananke: ['三暗刻', 2, '三組自己摸成的刻子'],
  sianke: ['四暗刻', 5, '四組自己摸成的刻子'],
  wuanke: ['五暗刻', 8, '五組自己摸成的刻子'],
  pengpeng: ['碰碰胡', 4, '五組都是刻子或槓子'],
  hunyise: ['混一色', 4, '只有一種數字牌加上字牌'],
  qingyise: ['清一色', 8, '整副牌只有一種數字牌'],
  ziyise: ['字一色', 16, '整副牌都是字牌'],
  xiaosanyuan: ['小三元', 4, '中發白兩組刻子加一對'],
  dasanyuan: ['大三元', 8, '中發白三組刻子'],
  xiaosixi: ['小四喜', 8, '東南西北三組刻子加一對'],
  dasixi: ['大四喜', 16, '東南西北四組刻子'],
  tianhu: ['天胡', 24, '莊家起手就胡牌'],
  dihu: ['地胡', 16, '閒家第一次摸牌就自摸'],
  renhu: ['人胡', 8, '莊家打出第一張牌就被閒家胡'],
  baxian: ['八仙過海', 8, '八張花牌全部到手，直接胡牌'],
  qiqiangyi: ['七搶一', 8, '手上有七張花，搶走別人的第八張花胡牌'],
};

const item = (key, n) => ({ key, name: TAI[key][0], tai: n == null ? TAI[key][1] : n });

// ctx：{
//   concealed：手上牌種（含胡的那張）, melds：[{ kind:'chow'|'pung'|'kong', t, concealed }],
//   flowers：花牌牌種, winTile, selfDraw, seatWind, roundWind,
//   last（最後一張）, afterKong, robKong, tianhu, dihu, renhu, flowerWin：'baxian'|'qiqiangyi'
// }
export function scoreHand(ctx) {
  const items = [];
  // 花
  const fl = ctx.flowers || [];
  for (const f of fl) if (flowerSeat(f) === ctx.seatWind) items.push({ ...item('ruleFlower'), name: `正花（${'春夏秋冬梅蘭竹菊'[f - FLOWER0]}）` });
  for (const base of [FLOWER0, FLOWER0 + 4]) if ([0, 1, 2, 3].every((k) => fl.includes(base + k))) items.push({ ...item('flowerKong'), name: base === FLOWER0 ? '花槓（春夏秋冬）' : '花槓（梅蘭竹菊）' });
  if (ctx.flowerWin) {
    items.push(item(ctx.flowerWin));
    return finish(items);
  }

  const melds = ctx.melds || [];
  const need = 5 - melds.length;
  const counts = countsOf(ctx.concealed);
  const decs = decompose(counts, need);
  // 聽牌數（判斷獨聽、平胡）
  const before = counts.slice();
  before[ctx.winTile]--;
  const waitList = waits(before, need);
  const single = waitList.length === 1;

  // 每種拆法各算一次，取台數最高的
  let best = null;
  for (const d of decs.length ? decs : [null]) {
    const r = scoreDecomp(ctx, d, melds, single, waitList);
    if (!best || total(r) > total(best)) best = r;
  }
  items.push(...best);
  if (ctx.tianhu) items.push(item('tianhu'));
  else if (ctx.dihu) items.push(item('dihu'));
  else if (ctx.renhu) items.push(item('renhu'));
  return finish(items);
}

const total = (items) => items.reduce((a, b) => a + b.tai, 0);
const finish = (items) => ({ items, total: total(items) });

function scoreDecomp(ctx, d, melds, single, waitList) {
  const items = [];
  const open = melds.some((m) => !m.concealed);
  // 所有面子（含吃碰槓）
  const sets = melds.map((m) => ({ k: m.kind === 'chow' ? 'chow' : 'pung', t: m.t, concealed: !!m.concealed, kong: m.kind === 'kong' }));
  if (d) {
    for (const s of d.sets) {
      // 靠放槍完成的刻子不算暗刻（若同一張也能當順子則視為順子完成，比較划算）
      let concealed = true;
      if (s.k === 'pung' && !ctx.selfDraw && s.t === ctx.winTile) {
        const altChow = d.sets.some((x) => x.k === 'chow' && x.t <= ctx.winTile && ctx.winTile <= x.t + 2);
        if (!altChow && d.pair !== ctx.winTile) concealed = false;
      }
      sets.push({ ...s, concealed });
    }
  }
  const pair = d ? d.pair : -1;

  // 門清／自摸
  if (!open && ctx.selfDraw) items.push(item('menqingZimo'));
  else {
    if (!open) items.push(item('menqing'));
    if (ctx.selfDraw) items.push(item('zimo'));
  }
  if (ctx.selfDraw && ctx.last) items.push(item('haidi'));
  if (!ctx.selfDraw && ctx.last) items.push(item('hedi'));
  if (ctx.afterKong && ctx.selfDraw) items.push(item('gangshang'));
  if (ctx.robKong) items.push(item('qianggang'));

  // 全求人：五組都是明的，單吊放槍
  if (melds.length === 5 && melds.every((m) => !m.concealed) && !ctx.selfDraw) items.push(item('quanqiuren'));
  else if (single) items.push(item('duting'));

  const pungs = sets.filter((s) => s.k === 'pung');
  const chows = sets.filter((s) => s.k === 'chow');
  // 平胡
  const all = [...ctx.concealed, ...melds.flatMap((m) => (m.kind === 'chow' ? [m.t, m.t + 1, m.t + 2] : [m.t]))];
  const anyHonor = all.some(isHonor);
  if (d && chows.length === 5 && !anyHonor && !(ctx.flowers || []).length && !ctx.selfDraw && waitList.length >= 2) items.push(item('pinghu'));
  // 碰碰胡
  if (d && pungs.length === 5) items.push(item('pengpeng'));
  // 暗刻
  const an = pungs.filter((s) => s.concealed).length;
  if (an >= 5) items.push(item('wuanke'));
  else if (an === 4) items.push(item('sianke'));
  else if (an === 3) items.push(item('sananke'));
  // 一色
  const suits = new Set(all.filter((t) => !isHonor(t)).map(suitOf));
  if (!suits.size) items.push(item('ziyise'));
  else if (suits.size === 1) items.push(item(anyHonor ? 'hunyise' : 'qingyise'));
  // 三元
  const dragonPungs = pungs.filter((s) => isDragon(s.t)).length;
  if (dragonPungs === 3) items.push(item('dasanyuan'));
  else if (dragonPungs === 2 && isDragon(pair)) items.push(item('xiaosanyuan'));
  else for (const s of pungs) if (isDragon(s.t)) items.push({ ...item('dragon'), name: `三元牌（${['紅中', '青發', '白板'][s.t - 31]}）` });
  // 風
  const windPungs = pungs.filter((s) => s.t >= 27 && s.t <= 30);
  if (windPungs.length === 4) items.push(item('dasixi'));
  else if (windPungs.length === 3 && pair >= 27 && pair <= 30) items.push(item('xiaosixi'));
  else {
    for (const s of windPungs) {
      const w = s.t - 27;
      if (w === ctx.roundWind) items.push({ ...item('windRound'), name: `圈風（${WIND_NAMES[w]}）` });
      if (w === ctx.seatWind) items.push({ ...item('windSeat'), name: `門風（${WIND_NAMES[w]}）` });
    }
  }
  return items;
}

// 算錢：每家付「底＋台數×每台」；莊家相關的那一筆多算莊家台與連莊台
// win：{ winner, payers:[座位], tai, dealer, streak }；回傳 deltas[4] 與明細
export function settle({ winner, payers, tai, dealer, streak, base, perTai }) {
  const deltas = [0, 0, 0, 0];
  const lines = [];
  for (const p of payers) {
    let t = tai;
    let extra = 0;
    if (winner === dealer || p === dealer) extra = 1 + 2 * streak;
    t += extra;
    const amt = base + t * perTai;
    deltas[p] -= amt;
    deltas[winner] += amt;
    lines.push({ payer: p, tai: t, extra, amount: amt });
  }
  return { deltas, lines };
}

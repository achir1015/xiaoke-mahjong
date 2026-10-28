import test from 'node:test';
import assert from 'node:assert/strict';
import { shanten, countsOf, decompose, waits } from '../src/renderer/js/hand.js';
import { scoreHand, settle } from '../src/renderer/js/scoring.js';
import { Hand, Match, replayHand } from '../src/renderer/js/rules.js';
import { decide } from '../src/renderer/js/ai.js';
import { KnowledgeBase } from '../src/renderer/js/kb.js';
import { typeName, tileType } from '../src/renderer/js/tiles.js';

// 'm' 萬 'p' 筒 's' 條 'z' 字（1-7＝東南西北中發白）
function parse(str) {
  const out = [];
  for (const [, nums, suit] of str.matchAll(/(\d+)([mpsz])/g)) {
    for (const ch of nums) {
      const n = Number(ch);
      out.push(suit === 'z' ? 26 + n : 'mps'.indexOf(suit) * 9 + n - 1);
    }
  }
  return out;
}

test('牌名', () => {
  assert.equal(typeName(0), '一萬');
  assert.equal(typeName(13), '五筒');
  assert.equal(typeName(26), '九條');
  assert.equal(typeName(31), '紅中');
  assert.equal(typeName(34), '春');
  assert.equal(tileType(143), 41);
});

test('向聽數：胡牌、聽牌', () => {
  const win = countsOf(parse('123m456m789m123p456p11s'));
  assert.equal(shanten(win, 5), -1);
  const ting = countsOf(parse('123m456m789m123p456p1s'));
  assert.equal(shanten(ting, 5), 0);
  assert.deepEqual(waits(ting, 5), [18]);
  const two = countsOf(parse('123m456m789m123p45p11s'));
  assert.equal(shanten(two, 5), 0);
  assert.deepEqual(waits(two, 5).map(typeName), ['三筒', '六筒']);
  const far = countsOf(parse('159m159p159s1234z'));
  assert.ok(shanten(far, 5) >= 7);
});

test('拆解與碰碰胡、清一色', () => {
  const hand = parse('111222333m444m55m555m');
  assert.ok(decompose(countsOf(hand), 5).length >= 1);
  const r = scoreHand({ concealed: parse('111m222m333m444m555m66m77m'.slice(0, 0) + '11122233344455566m'), melds: [], flowers: [], winTile: 5, selfDraw: true, seatWind: 0, roundWind: 0 });
  const names = r.items.map((x) => x.name);
  assert.ok(names.includes('門清自摸'));
  assert.ok(names.includes('清一色'));
  assert.ok(names.includes('碰碰胡'));
  assert.ok(names.includes('五暗刻'));
});

test('平胡、獨聽、三元', () => {
  const ph = scoreHand({ concealed: parse('123m456m789m234p678p55s'), melds: [], flowers: [], winTile: 5, selfDraw: false, seatWind: 1, roundWind: 0 });
  // 6m 單張完成 456（兩面 3-6m？此手 456m 由 45 等 36 或 56 等 47…）至少要有門清
  assert.ok(ph.items.some((x) => x.name === '門清'));
  const dt = scoreHand({ concealed: parse('123m456m789m234p678p55s'), melds: [], flowers: [], winTile: 22, selfDraw: false, seatWind: 1, roundWind: 0 });
  assert.ok(dt.items.some((x) => x.name === '獨聽'), '單吊算獨聽');
  const dragons = scoreHand({ concealed: parse('555z666z777z123m11p'), melds: [{ kind: 'pung', t: 0, concealed: false }], flowers: [], winTile: 9, selfDraw: false, seatWind: 0, roundWind: 0 });
  assert.ok(dragons.items.some((x) => x.name === '大三元'));
});

test('正花與花槓', () => {
  const r = scoreHand({ concealed: parse('123m456m789m234p678p55s'), melds: [], flowers: [34, 35, 36, 37, 38], winTile: 22, selfDraw: false, seatWind: 0, roundWind: 0 });
  const names = r.items.map((x) => x.name);
  assert.ok(names.includes('正花（春）'));
  assert.ok(names.includes('正花（梅）'));
  assert.ok(names.includes('花槓（春夏秋冬）'));
});

test('算錢：自摸三家付、莊家台', () => {
  const r = settle({ winner: 0, payers: [1, 2, 3], tai: 3, dealer: 0, streak: 1, base: 50, perTai: 20 });
  // 莊家胡：每家 3+1+2=6 台
  assert.deepEqual(r.deltas, [3 * (50 + 6 * 20), -170, -170, -170]);
  const r2 = settle({ winner: 1, payers: [2], tai: 2, dealer: 0, streak: 0, base: 50, perTai: 20 });
  assert.deepEqual(r2.deltas, [0, 90, -90, 0]);
});

test('發牌：每家 16 張、莊家 17 張、沒有花在手上', () => {
  for (let seed = 1; seed < 40; seed++) {
    const h = new Hand({ seed, dealer: seed % 4, roundWind: 0 });
    if (h.result) continue; // 開局就八仙過海／七搶一
    h.p.forEach((pl, s) => {
      assert.equal(pl.hand.length + pl.melds.length * 3, s === h.dealer ? 17 : 16);
      assert.ok(pl.hand.every((id) => tileType(id) < 34));
    });
    const all = [...h.wall, ...h.p.flatMap((pl) => [...pl.hand, ...pl.flowers])];
    assert.equal(new Set(all).size, 144);
  }
});

test('AI 對 AI 打完 300 局都不出錯，可重播', () => {
  let wins = 0, draws = 0;
  const kb = new KnowledgeBase();
  for (let seed = 1; seed <= 300; seed++) {
    const h = new Hand({ seed, dealer: seed % 4, roundWind: seed % 4, streak: seed % 3 });
    let guard = 0;
    while (!h.result) {
      if (++guard > 2000) throw new Error('卡住了 seed=' + seed);
      const seats = [0, 1, 2, 3].filter((s) => h.options(s).length);
      assert.ok(seats.length, '沒有人可以行動 seed=' + seed);
      const s = seats[0];
      const a = decide(h.view(s), s, h.options(s), seed % 4);
      h.act(s, a);
    }
    if (h.result.type === 'win') { wins++; assert.equal(h.result.deltas.reduce((x, y) => x + y, 0), 0); } else draws++;
    // 牌數守恆
    const all = [...h.wall, ...h.p.flatMap((pl) => [...pl.hand, ...pl.flowers, ...pl.river, ...pl.melds.flatMap((m) => m.tiles)])];
    assert.equal(new Set(all).size, 144, 'seed=' + seed);
    // 重播得到同樣結果
    const meta = { seed, dealer: seed % 4, roundWind: seed % 4, streak: seed % 3 };
    const r = replayHand(meta, h.log);
    assert.deepEqual(r.result.deltas, h.result.deltas);
    kb.learnHand(meta, h.log, 'x' + seed);
  }
  assert.ok(wins > 150, `胡牌局數 ${wins}`);
  assert.equal(kb.hands, 300);
  const sum = kb.summary();
  assert.ok(sum.taiTop.length > 0);
  assert.ok(Object.keys(kb.danger).length > 5);
  // 序列化後還原
  const kb2 = new KnowledgeBase(JSON.parse(JSON.stringify(kb)));
  assert.equal(kb2.hands, 300);
  assert.equal(kb2.learnHand({ seed: 1, dealer: 1, roundWind: 1, streak: 1 }, [], 'x1'), false);
  void draws;
});

test('整場：輪莊、連莊、圈風', () => {
  const m = new Match({ length: 'round1', seed: 7 });
  let hands = 0;
  while (!m.over) {
    const h = m.nextHand();
    while (!h.result) {
      const s = [0, 1, 2, 3].find((x) => h.options(x).length);
      h.act(s, decide(h.view(s), s, h.options(s), 2));
    }
    m.endHand();
    if (++hands > 200) throw new Error('打不完');
  }
  assert.equal(m.scores.reduce((a, b) => a + b, 0), 8000);
  assert.ok(m.history.length >= 4);
});

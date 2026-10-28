import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, PRACTICE, T, practiceAnswer } from '../src/renderer/js/guide.js';
import { countsOf, shanten, waits } from '../src/renderer/js/hand.js';
import { typeName } from '../src/renderer/js/tiles.js';

test('每一課的牌列與標示都在範圍內', () => {
  for (const L of LESSONS) {
    assert.ok(L.steps.length >= 3, L.title);
    for (const st of L.steps) {
      assert.ok(st.say && st.say.length > 10);
      for (const row of st.rows) {
        for (const t of row.tiles) assert.ok(t === -1 || (t >= 0 && t <= 41), `${L.title} 牌 ${t}`);
        for (const [s, n] of row.groups || []) assert.ok(s >= 0 && s + n <= row.tiles.length, `${L.title} ${row.label} 標示超出範圍`);
        for (const k of row.hl || []) assert.ok(k < row.tiles.length, `${L.title} ${row.label} hl`);
      }
    }
  }
});

test('說明裡的胡牌與聽牌例子都正確', () => {
  for (const L of LESSONS) for (const st of L.steps) {
    if (!st.check) continue;
    const c = countsOf(T(st.check.hand));
    if (st.check.win) assert.equal(shanten(c, 5), -1, st.check.hand);
    if (st.check.waits) assert.deepEqual(waits(c, 5).map(typeName), st.check.waits);
  }
  // 標成 17 張或 16 張的手牌都要合法
  for (const L of LESSONS) for (const st of L.steps) for (const row of st.rows) {
    if (L.id !== 'talk' && /胡牌|門清|到！|平胡|碰碰胡|混一色|清一色/.test(row.label)) {
      assert.equal(row.tiles.length, 17, `${L.title}：${row.label} 應為 17 張`);
      assert.equal(shanten(countsOf(row.tiles), 5), -1, `${L.title}：${row.label} 應該是胡牌`);
    }
  }
});

test('練習題都有正確答案', () => {
  for (const p of PRACTICE) {
    const ans = practiceAnswer(p);
    assert.ok(ans.length >= 1, p.q + ' ' + p.hand);
    if (p.kind === 'discard') assert.equal(T(p.hand).length, 17);
    if (p.kind === 'waits') assert.equal(T(p.hand).length, 16);
  }
  assert.deepEqual(practiceAnswer(PRACTICE[3]).map(typeName), ['一萬', '二萬', '三萬', '四萬', '五萬', '六萬', '七萬', '八萬', '九萬']);
  assert.equal(practiceAnswer(PRACTICE[4])[0], 2); // 門清＋獨聽
});

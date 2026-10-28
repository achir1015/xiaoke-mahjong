// 遊戲說明語音測試：進入說明就自動朗讀、字幕跟著換、點別課也會念、練習題會念題目
// 用法：node e2e/guide-voice.mjs
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eSmoke', '--autoplay-policy=no-user-gesture-required'] });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.setViewportSize({ width: Number(process.env.W || 1500), height: Number(process.env.H || 900) }).catch(() => {});
await win.waitForSelector('#startAI');
await win.evaluate(() => document.querySelectorAll('.modal-back').forEach((b) => b.remove()));
// 記錄每一句送給語音引擎的話
await win.evaluate(() => {
  window.__said = [];
  const orig = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => { window.__said.push(u.text); orig(u); };
});
const said = () => win.evaluate(() => window.__said.slice());
const state = () => win.evaluate(() => ({ speaking: speechSynthesis.speaking, play: document.querySelector('#gdPlay').textContent, step: document.querySelector('.gd-step').textContent, voices: speechSynthesis.getVoices().filter((v) => /zh/i.test(v.lang)).map((v) => v.name) }));

try {
  await win.click('#btnGuide');
  await win.waitForSelector('.gd-tile');
  await win.waitForTimeout(2500);
  const s1 = await state();
  console.log('中文語音：', s1.voices.join('、'));
  check('有中文語音可用', s1.voices.length > 0);
  check('進入說明就自動開始講解', s1.play.includes('暫停') && s1.speaking, JSON.stringify(s1));
  const l1 = await said();
  check('念的是第一課第一段', l1.length >= 1 && l1[0].includes('144'), l1[0]);
  // 等它念完第一段、自動換到第二段
  let advanced = false;
  for (let i = 0; i < 80 && !advanced; i++) { await win.waitForTimeout(500); advanced = (await state()).step.includes('2 /'); }
  check('念完自動換到下一段（字幕與牌也跟著換）', advanced, (await state()).step);
  const l2 = await said();
  check('第二段也有念出來', l2.length >= 2 && l2[1].includes('萬子'), l2[1]);
  // 點台語口語課
  await win.click('.gd-item[data-i="8"]');
  await win.waitForTimeout(1500);
  const l3 = await said();
  const s3 = await state();
  check('點選其他課會自動朗讀該課', s3.speaking && l3[l3.length - 1].includes('吃'), l3[l3.length - 1]);
  check('台語課念的是中文說法（不唸拼音）', !/[àáèéìíòóùú]|ā|̍/.test(l3[l3.length - 1]), l3[l3.length - 1]);
  // 暫停
  await win.click('#gdPlay');
  await win.waitForTimeout(400);
  check('按暫停會停止語音', !(await state()).speaking);
  // 練習題念題目
  await win.click('.gd-item[data-i="p"]');
  await win.waitForTimeout(800);
  const l4 = await said();
  check('練習題會念題目', l4[l4.length - 1].includes('聽牌'), l4[l4.length - 1]);
  await win.click('.gd-tiles.pick .gd-tile');
  await win.waitForTimeout(500);
  const l5 = await said();
  check('作答後會念出對錯', /答對了|再想想/.test(l5[l5.length - 1]), l5[l5.length - 1]);
  // 版面：17 張一排不換行
  await win.click('.gd-item[data-i="4"]');
  await win.waitForTimeout(1200);
  const lay = await win.evaluate(() => { const row = document.querySelector('.gd-tiles'); const ts = [...row.children]; const tops = new Set(ts.map((t) => t.offsetTop)); return { n: ts.length, lines: tops.size, fits: row.scrollWidth <= document.querySelector('.gd-stage').clientWidth }; });
  check('胡牌 17 張排成一排、不超出', lay.n === 17 && lay.lines === 1 && lay.fits, JSON.stringify(lay));
  await win.screenshot({ path: 'e2e/out/gv-win.png' });
  check('沒有錯誤', errors.length === 0, errors.join('\n'));
} catch (e) {
  fail++; console.log('✘ 例外：', e.message);
} finally {
  await app.close();
  console.log(`\n通過 ${pass}，失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
}

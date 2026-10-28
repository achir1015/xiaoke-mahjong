// 用真實視窗（最大化、不模擬尺寸）截圖首頁、牌桌、說明：node e2e/real-window.mjs
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eSmoke'] });
const win = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.maximize(); });
await win.waitForSelector('#startAI');
// 用 Electron 擷取視窗實際畫面（playwright 截圖在縮放時會失真）
const capture = async (name) => { const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')); (await import('fs')).writeFileSync(`e2e/out/${name}.png`, Buffer.from(b64, 'base64')); };
await win.waitForTimeout(800);
const info = await win.evaluate(() => ({ dpr: devicePixelRatio, inner: [innerWidth, innerHeight], doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], zoom: 1 }));
const wb = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; return { bounds: w.getBounds(), content: w.getContentSize(), max: w.isMaximized(), zoom: w.webContents.getZoomFactor(), wa: screen.getPrimaryDisplay().workAreaSize, scale: screen.getPrimaryDisplay().scaleFactor }; });
console.log(JSON.stringify({ ...info, ...wb }));
await win.evaluate(() => document.querySelectorAll('.modal-back').forEach((b) => b.remove()));
await capture('real-home');
await win.click('#btnGuide');
await win.waitForTimeout(1500);
const g = await win.evaluate(() => { const r = document.querySelector('.gd-side').getBoundingClientRect(); return { side: [Math.round(r.left), Math.round(r.right)], inner: innerWidth }; });
console.log('說明右側', JSON.stringify(g));
await capture('real-guide');
await win.click('.gd-back');
await win.click('#startAI');
await win.waitForTimeout(4000);
const t = await win.evaluate(() => { const r = document.querySelector('.right').getBoundingClientRect(); return { right: [Math.round(r.left), Math.round(r.right)], inner: innerWidth }; });
console.log('牌桌右側', JSON.stringify(t));
await capture('real-table');
await app.close();

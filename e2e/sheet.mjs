// 檢查用：把 SVG 總覽頁截圖（node e2e/sheet.mjs 檔案.html 輸出.png [寬度]）
import { chromium } from 'playwright-core';
import path from 'path';
import { pathToFileURL } from 'url';

const [file, out, w = '1300'] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: Number(w), height: 900 } });
await p.goto(pathToFileURL(path.resolve(file)).href);
await p.waitForTimeout(500);
await p.screenshot({ path: out, fullPage: true });
await b.close();

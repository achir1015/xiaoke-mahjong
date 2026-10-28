# 小柯機器人台灣麻將遊戲
<img width="1919" height="1079" alt="image" src="https://github.com/user-attachments/assets/64522596-ed0c-40a6-bc2e-21c7b442a543" />
桌面版媒體示範

https://github.com/user-attachments/assets/92e0065e-6c71-4149-ba65-12427e23d527

手機版媒體示範

https://github.com/user-attachments/assets/4b401f23-62e6-485f-96aa-2292af8e7eac

https://github.com/user-attachments/assets/52ffd9d7-de1f-4143-a948-e881bc0d57fd

3D 台灣 16 張麻將：一人對三位 AI、邀約遠端真人（語音＋聊天）、全部 AI 對戰、AI 軍師指點與代打、麻將智庫（牌譜重播、AI 學習）、20 首原創背景音樂、遊戲說明（動畫＋語音）、自動更新。

**遊戲開發：吳玉柱 先生 與 Claude AI Opus 5.5**

## 下載

到 [Releases](https://github.com/achir1015/xiaoke-mahjong/releases/latest) 下載：

| 平台 | 檔案 |
|---|---|
| Windows 11 | `XiaokeMahjong-版本-win-x64.exe`（安裝版）／`-portable.exe`（免安裝） |
| MacBook Pro（Apple 晶片） | `XiaokeMahjong-版本-mac-arm64.dmg` |
| Intel Mac | `XiaokeMahjong-版本-mac-x64.dmg` |
| Android 手機 | `XiaokeMahjong-版本-android.apk`（橫向畫面） |
| iPad／iPhone | `xiaoke-mahjong-ios.ipa`：用 Safari 開 [安裝頁](https://achir1015.github.io/xiaoke-mahjong/ios/) 按「安裝」（App Store 上架前限開發者登記過的裝置；第一次要在「設定 → 隱私權與安全性」開啟「開發者模式」） |

- **iPhone／iPad 版**：`ios/`（XcodeGen 專案，WKWebView＋App 內本機伺服器，和 Android 版同一份遊戲程式）。在 Mac 上執行 `node scripts/build-mobile.mjs`（或從 Windows 產生後複製）→ `bash ios/sync.sh` → 用 Xcode 開 `ios/XiaokeMahjong.xcodeproj` 執行；也可用 `osascript ios/run-on-iphone.applescript <專案路徑>` 讓 Xcode 直接裝到接著的 iPhone。
- **iPad／iPhone 的 .ipa**：在 Mac 的終端機執行 `bash ios/build-ipa.sh`（從 SSH 要用 `osascript ios/run-in-terminal.applescript "bash <路徑>/ios/build-ipa.sh"`，鑰匙圈才解得開），產出 Ad Hoc 簽章的 `ios/build/xiaoke-mahjong-ios.ipa`，上傳到 Release（檔名固定），再把 `docs/ios/manifest.plist` 的 `bundle-version` 改成新版號。新裝置要先登記：Mac 上執行 `python3 ios/udid-server.py`，iPad 用 Safari 開畫面上的網址、安裝描述檔就會顯示 UDID，到 [Apple Developer → Devices](https://developer.apple.com/account/resources/devices/add) 登記後重做 .ipa。

## 規則重點

- 144 張（萬、筒、條、字牌、八張花），每人 16 張、莊家 17 張；摸到花補花。
- 胡牌＝5 組面子＋1 對眼；可吃（上家）、碰、明槓、暗槓、加槓；胡＞碰槓＞吃，同時胡由下家截胡；過水不胡；搶槓。
- 留 16 張不摸，摸完流局，莊家連莊。
- 計分：每家付「底＋台數×每台」；自摸三家付、放槍一家付；莊家相關那一筆加莊家台與「連 N 拉 N」。
- 台數：門清、自摸、門清自摸、莊家、連莊、正花、花槓、三元牌、圈風、門風、平胡、獨聽、全求人、海底撈月、河底撈魚、槓上開花、搶槓、三／四／五暗刻、碰碰胡、混一色、清一色、字一色、小／大三元、小／大四喜、天胡、地胡、人胡、八仙過海、七搶一。

規則與台數參考 [yuweiiihuang/mahjong16](https://github.com/yuweiiihuang/mahjong16)（台灣 16 張麻將環境），本專案以 JavaScript 自行實作。

## 開發

```bash
npm install
npm start          # 開發模式執行
npm test           # 規則、台數、AI、智庫、說明單元測試
npm run e2e        # 端對端測試（Electron）
node e2e/net.mjs   # 遠端對戰測試（本機配對伺服器＋四個實例）
npm run dist:win   # 打包 Windows 安裝檔
python android/build.py debug install   # 建置 Android APK 並裝到 USB 連接的手機
node e2e/mobile.mjs  # 手機版網頁（模擬手機尺寸）
node e2e/phone.mjs   # 實機測試（除錯版 APK）
```

- `src/renderer/js/rules.js`：牌局引擎（發牌、補花、摸打、吃碰槓、胡、流局、整場）
- `src/renderer/js/hand.js`、`scoring.js`：向聽數、聽牌、拆解與台數
- `src/renderer/js/ai.js`、`kb.js`：AI 與麻將智庫
- `src/renderer/js/table3d.js`：Three.js 3D 牌桌
- `src/renderer/js/guide.js`：遊戲說明與練習題
- `scripts/`：背景音樂、頭像、程式圖示產生器（皆為原創程序生成）

推送 `main` 且 `package.json` 版本號改變後，GitHub Actions 會自動建置 Windows／macOS 安裝檔並發佈 Release，程式內的「檢查更新」就會找到新版。

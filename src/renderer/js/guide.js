// 遊戲說明：動畫示範＋語音講解＋練習題
// 規則、台數、得分失分、台語麻將口語
import { $, $$, h, toast } from './util.js';
import { faceUrl, typeName } from './tiles.js';
import { countsOf, shanten, waits } from './hand.js';
import { scoreHand, TAI } from './scoring.js';

// 牌的寫法：'123m' 萬、'p' 筒、's' 條、'z' 字（1-7＝東南西北中發白）、'f' 花（1-8）
export function T(str) {
  const out = [];
  for (const [, nums, suit] of String(str).matchAll(/(\d+)([mpszf])/g)) {
    for (const ch of nums) {
      const n = Number(ch);
      out.push(suit === 'z' ? 26 + n : suit === 'f' ? 33 + n : 'mps'.indexOf(suit) * 9 + n - 1);
    }
  }
  return out;
}

// 每一步：say（語音與字幕）、rows（要顯示的牌列）
// row：{ label, tiles, groups:[[起, 張數, 顏色, 文字]], hl:[索引], fly:索引（從上方飛入）, dim:[索引] }
export const LESSONS = [
  {
    id: 'tiles', title: '認識麻將牌', steps: [
      { say: '台灣麻將一副共有 144 張牌。先來認識三種「數牌」：萬子、筒子、條子，每種都是一到九，每一張各有四張。', rows: [{ label: '萬子', tiles: T('123456789m') }, { label: '筒子', tiles: T('123456789p') }, { label: '條子', tiles: T('123456789s') }] },
      { say: '萬子上面寫數字、下面寫「萬」字；筒子是圓圈，幾個圈就是幾筒；條子是竹子，一條通常畫成一隻孔雀。', rows: [{ label: '一萬～九萬', tiles: T('19m'), hl: [0, 1] }, { label: '一筒、九筒', tiles: T('19p'), hl: [0, 1] }, { label: '一條是孔雀', tiles: T('1s'), hl: [0] }] },
      { say: '接著是「字牌」：東、南、西、北四種風牌，加上紅中、青發、白板三種三元牌，每種也是四張。', rows: [{ label: '風牌', tiles: T('1234z') }, { label: '三元牌', tiles: T('567z') }] },
      { say: '最後是八張「花牌」：春夏秋冬、梅蘭竹菊各一張。花牌不能用來組牌，摸到就要亮出來、再從牌尾補一張，叫做「補花」。', rows: [{ label: '四季', tiles: T('1234f') }, { label: '四君子', tiles: T('5678f') }] },
      { say: '數牌一百零八張、字牌二十八張、花牌八張，加起來剛好一百四十四張。一和九的數牌叫做「么九」。', rows: [{ label: '么九牌', tiles: T('19m19p19s'), hl: [0, 1, 2, 3, 4, 5] }] },
    ],
  },
  {
    id: 'start', title: '開局：發牌與補花', steps: [
      { say: '四個人坐東、南、西、北四個位子，東家就是「莊家」。擲骰子決定從哪裡開始拿牌。', rows: [{ label: '四個門風', tiles: T('1234z'), groups: [[0, 1, '#ff6a4a', '莊']] }] },
      { say: '每個人拿十六張牌，莊家多拿一張共十七張，先打第一張牌，這叫「開門」。', rows: [{ label: '閒家 16 張', tiles: T('11234m345p6789s1155z') }, { label: '莊家 17 張', tiles: T('11234m345p6789s1155z9m'), hl: [16] }] },
      { say: '手上如果有花牌，就要亮在桌上，再從牌尾補一張。補到花牌就再補，直到沒有花為止。', rows: [{ label: '摸到花', tiles: T('3f'), hl: [0] }, { label: '亮出補牌', tiles: T('3f7p'), groups: [[0, 1, '#e86a8a', '花'], [1, 1, '#35c46b', '補']] }] },
      { say: '牌牆最後要留十六張不摸。正常的牌都摸完了還沒有人胡，就是「流局」，也叫荒莊，莊家繼續連莊。', rows: [{ label: '留 16 張', tiles: Array(16).fill(-1) }] },
    ],
  },
  {
    id: 'turn', title: '摸牌與打牌', steps: [
      { say: '從莊家開始，照東、南、西、北的順序（逆時針）輪流。輪到你時先摸一張，再打出一張，手上永遠保持十六張。', rows: [{ label: '手牌', tiles: T('11234m345p6789s1155z') }, { label: '摸進', tiles: T('7m'), fly: 0 }] },
      { say: '打出的牌放在自己面前，排成一排排的，叫做「牌河」。大家都看得到，可以從牌河推測別人要什麼牌。', rows: [{ label: '牌河', tiles: T('1z9p2s6z7z1m') }] },
      { say: '打牌的原則：先打用不到的孤張，例如單獨的字牌、跟其他牌都連不起來的么九牌。', rows: [{ label: '手牌', tiles: T('23m345p6789s56s4z1155z'), hl: [11], groups: [[11, 1, '#ff5252', '孤張']] }] },
    ],
  },
  {
    id: 'meld', title: '吃、碰、槓', steps: [
      { say: '「吃」：上家打出的數牌，剛好能跟你手上兩張湊成順子，就可以喊吃。只能吃上家，字牌不能吃。', rows: [{ label: '手上', tiles: T('34m') }, { label: '上家打出', tiles: T('5m'), hl: [0] }, { label: '吃成順子', tiles: T('345m'), groups: [[0, 3, '#35c46b', '吃']] }] },
      { say: '「碰」：手上有一對，任何人打出第三張，都可以喊碰，湊成刻子。', rows: [{ label: '手上一對', tiles: T('55z') }, { label: '有人打出', tiles: T('5z'), hl: [0] }, { label: '碰成刻子', tiles: T('555z'), groups: [[0, 3, '#4fa3e0', '碰']] }] },
      { say: '「槓」：四張一樣的牌。手上有三張、別人打出第四張是「明槓」；自己摸齊四張是「暗槓」；碰過之後再摸到第四張是「加槓」。槓完要從牌尾補一張。', rows: [{ label: '明槓', tiles: T('7777p'), groups: [[0, 4, '#e8b84a', '槓']] }, { label: '暗槓', tiles: [-1, 26 + 1, 26 + 1, -1], groups: [[0, 4, '#e8b84a', '暗槓']] }] },
      { say: '同一張牌好幾個人要的時候，優先順序是：胡最大，碰和槓第二，吃最小。兩個人同時胡，由離打牌的人最近的下家胡，叫做「截胡」。', rows: [{ label: '優先', tiles: T('5z'), groups: [[0, 1, '#ff5252', '胡＞碰槓＞吃']] }] },
    ],
  },
  {
    id: 'win', title: '胡牌的牌型', steps: [
      { say: '胡牌需要十七張：五組「面子」加上一對「眼」。面子可以是順子（三張連續的數牌），也可以是刻子（三張一樣）。', rows: [{ label: '胡牌', tiles: T('123m456m789p333s555z11z'), groups: [[0, 3, '#35c46b', '順'], [3, 3, '#35c46b', '順'], [6, 3, '#35c46b', '順'], [9, 3, '#4fa3e0', '刻'], [12, 3, '#4fa3e0', '刻'], [15, 2, '#e86a8a', '眼']] }], check: { hand: '123m456m789p333s555z11z', win: true } },
      { say: '只差一張就能胡，叫做「聽牌」。例如這副牌，聽三萬或六萬，兩頭都可以，叫做「兩面聽」。', rows: [{ label: '聽牌', tiles: T('45m123p456p789s111z22z'), groups: [[0, 2, '#ffd24a', '等 3、6萬']] }], check: { hand: '45m123p456p789s111z22z', waits: ['三萬', '六萬'] } },
      { say: '如果只聽一張，叫做「獨聽」，例如：邊張、中洞、單吊。獨聽胡牌可以多算一台。', rows: [{ label: '邊張（等三萬）', tiles: T('12m'), groups: [[0, 2, '#ffd24a', '邊張']] }, { label: '中洞（等五筒）', tiles: T('46p'), groups: [[0, 2, '#ffd24a', '中洞']] }, { label: '單吊（等紅中）', tiles: T('5z'), groups: [[0, 1, '#ffd24a', '單吊']] }] },
      { say: '自己摸到胡的那張叫「自摸」，三家都要付錢；胡別人打出的牌，叫對方「放槍」（台語說「放銃」），只有放槍的人付錢。', rows: [{ label: '自摸', tiles: T('3m'), groups: [[0, 1, '#35c46b', '三家付']] }, { label: '放槍', tiles: T('3m'), groups: [[0, 1, '#ff5252', '一家付']] }] },
      { say: '可以胡卻沒有胡，在自己下次摸牌之前都不能再胡別人的牌，這叫「過水」。別人加槓的那張剛好是你要的，可以「搶槓」胡牌。', rows: [{ label: '過水', tiles: T('3m'), dim: [0] }] },
    ],
  },
  {
    id: 'tai1', title: '台數（一）基本台', steps: [
      { say: '胡牌之後要算「台數」，台數越多贏越多。先看最常見的：門清一台，就是沒有吃、碰、明槓。自摸一台。門清又自摸，合稱「門清自摸」三台。', rows: [{ label: '門清', tiles: T('123m456m789p333s555z11z'), groups: [[0, 17, '#35c46b', '沒有吃碰']] }] },
      { say: '莊家胡牌、或莊家放槍，這筆帳都要多算一台；莊家每連莊一次，再多兩台，叫做「連一拉一」。', rows: [{ label: '莊', tiles: T('1z'), groups: [[0, 1, '#ff6a4a', '莊家＋1']] }] },
      { say: '花牌跟自己門風一樣的叫「正花」，每張一台：東是春和梅、南是夏和蘭、西是秋和竹、北是冬和菊。春夏秋冬或梅蘭竹菊四張到齊，叫「花槓」，再加兩台。', rows: [{ label: '東家的正花', tiles: T('15f'), hl: [0, 1] }, { label: '花槓', tiles: T('1234f'), groups: [[0, 4, '#e86a8a', '花槓 2 台']] }] },
      { say: '中、發、白的刻子，每組一台。圈風或自己門風的刻子，也各一台。', rows: [{ label: '三元牌', tiles: T('555z'), groups: [[0, 3, '#ff5252', '1 台']] }, { label: '門風（東家的東）', tiles: T('111z'), groups: [[0, 3, '#4fa3e0', '1 台']] }] },
      { say: '「平胡」兩台：五組都是順子、沒有字牌也沒有花，聽兩面、不是自摸。「全求人」兩台：五組全部是吃碰來的，最後單吊別人打的牌。', rows: [{ label: '平胡', tiles: T('123m456m789p234s678s55s'), groups: [[0, 15, '#35c46b', '全是順子']] }] },
      { say: '還有幾個運氣台，各一台：摸最後一張自摸叫「海底撈月」、胡最後一張打出的牌叫「河底撈魚」、槓完補牌自摸叫「槓上開花」、搶別人加槓的牌叫「搶槓」。', rows: [{ label: '海底撈月', tiles: T('9p'), groups: [[0, 1, '#e8b84a', '最後一張']] }] },
    ],
  },
  {
    id: 'tai2', title: '台數（二）大牌', steps: [
      { say: '整副牌都是刻子，叫「碰碰胡」四台。自己摸成、沒有碰的刻子叫「暗刻」：三暗刻兩台、四暗刻五台、五暗刻八台。', rows: [{ label: '碰碰胡', tiles: T('111m555p333s999s777z22z'), groups: [[0, 3, '#4fa3e0', '刻'], [3, 3, '#4fa3e0', '刻'], [6, 3, '#4fa3e0', '刻'], [9, 3, '#4fa3e0', '刻'], [12, 3, '#4fa3e0', '刻'], [15, 2, '#e86a8a', '眼']] }] },
      { say: '只有一種數牌加上字牌，叫「混一色」四台；整副只有一種數牌，叫「清一色」八台；全部都是字牌，叫「字一色」十六台。', rows: [{ label: '混一色', tiles: T('123m456m789m111z555z77z') }, { label: '清一色', tiles: T('111222333456789p55p') }] },
      { say: '中發白三組刻子是「大三元」八台；兩組刻子加一對是「小三元」四台。東南西北四組刻子是「大四喜」十六台；三組刻子加一對是「小四喜」八台。', rows: [{ label: '大三元', tiles: T('555666777z'), groups: [[0, 3, '#ff5252', '中'], [3, 3, '#35c46b', '發'], [6, 3, '#4fa3e0', '白']] }] },
      { say: '最難得的：莊家一拿牌就胡，「天胡」二十四台；閒家第一次摸牌就自摸，「地胡」十六台；八張花全到手，「八仙過海」八台；七張花搶別人的第八張，「七搶一」八台。', rows: [{ label: '八仙過海', tiles: T('12345678f'), groups: [[0, 8, '#e8b84a', '8 台']] }] },
    ],
  },
  {
    id: 'money', title: '得分與失分', steps: [
      { say: '每一筆帳都是「底」加上「台數乘以每台」。例如底五十、每台二十，胡三台，就是五十加六十，一共一百一十。', rows: [{ label: '底 50＋3 台×20', tiles: T('3m'), groups: [[0, 1, '#e8b84a', '＝110']] }] },
      { say: '放槍的話，只有放槍的人付這一筆；自摸的話，其他三家每家都要付一筆。', rows: [{ label: '放槍：一家付', tiles: T('1z'), groups: [[0, 1, '#ff5252', '－110']] }, { label: '自摸：三家付', tiles: T('234z'), groups: [[0, 3, '#ff5252', '各－110']] }] },
      { say: '莊家有關的那一筆要多算莊家台：莊家胡牌，三家都多付；閒家胡牌、莊家付錢時，莊家也要多付。連莊越多次，加的台數越多。', rows: [{ label: '莊家連二', tiles: T('1z'), groups: [[0, 1, '#ff6a4a', '1＋2×2＝5 台']] }] },
      { say: '莊家胡牌或流局，莊家連莊；閒家胡牌就換下一家當莊。四家都當過莊，就換下一圈：東風圈、南風圈、西風圈、北風圈，打完四圈叫做一將。', rows: [{ label: '圈風', tiles: T('1234z'), groups: [[0, 1, '#e8b84a', '第一圈']] }] },
    ],
  },
  {
    id: 'talk', title: '台語麻將口語', steps: [
      { say: '牌桌上常聽到的台語：吃，台語唸作「tsia̍h」，就是吃上家的牌湊順子。碰，唸「pòng」。槓，唸「kòng」。', speak: '吃，就是吃上家的牌湊成順子。碰，手上有一對，拿別人打的第三張。槓，就是湊到四張一樣的牌。', rows: [{ label: '吃 Tsia̍h', tiles: T('345m') }, { label: '碰 Pòng', tiles: T('555z') }, { label: '槓 Kòng', tiles: T('7777p') }] },
      { say: '「聽」（thiann）是只差一張就能胡。胡牌的時候，台語常常直接喊一聲「到」（kàu）！自己摸到叫「自摸」（tsū-bong）。', speak: '聽，是只差一張就能胡。胡牌的時候，台語常常直接喊一聲「到」！自己摸到胡的那張叫自摸。', rows: [{ label: '到！', tiles: T('123m456m789p333s555z11z'), groups: [[0, 17, '#e8b84a', '到']] }] },
      { say: '打出的牌被別人胡，叫「放銃」（pàng-tshìng），也有人說「放炮」。「包牌」是因為放任或造成特定條件，由一個人負責賠全場。', speak: '打出的牌被別人胡，叫做放銃，也有人說放炮。包牌，是因為放任或造成特定條件，由一個人負責賠全場。', rows: [{ label: '放銃', tiles: T('5p'), groups: [[0, 1, '#ff5252', '被胡']] }] },
      { say: '牌桌上說「三跤到」：本來四個人打，其中一人因故不算或離開，只剩三個人的說法。', speak: '三跤到，是說牌局中有一個人因故不算或離開，只剩三個人。', rows: [{ label: '三跤', tiles: T('123z') }] },
      { say: '字牌的俗稱：東南西北常被叫成「烏東、烏南、烏西、烏北」。三元牌是青發（tshenn-huat）、白板（pe̍h-pán）、紅中（âng-tiong）。', speak: '字牌的俗稱：東南西北常被叫成烏東、烏南、烏西、烏北。三元牌是青發、白板、紅中。', rows: [{ label: '烏東 烏南 烏西 烏北', tiles: T('1234z') }, { label: '紅中 青發 白板', tiles: T('567z') }] },
      { say: '很多麻將用語變成日常口語：「清一色」引申為全部都一樣；「槓上開花」比喻運氣好、遇到喜事；「海底撈月」形容絕處逢生、不可思議的好運；「大三元」代表圓滿的境界。', rows: [{ label: '清一色', tiles: T('123456789p') }, { label: '大三元', tiles: T('567z'), groups: [[0, 3, '#e8b84a', '圓滿']] }] },
      { say: '牌桌俗諺：「贏筊的驚食飯，輸筊的驚天光」——手氣正旺的人怕離開桌子吃飯壞了手氣；輸得很慘的人，又怕天亮牌局結束，沒機會翻本。', speak: '牌桌俗諺：贏的人怕吃飯，輸的人怕天亮。手氣正旺的人，怕離開桌子吃飯壞了手氣；輸得很慘的人，又怕天亮牌局結束，沒機會翻本。', rows: [{ label: '贏筊的驚食飯', tiles: T('5z') }, { label: '輸筊的驚天光', tiles: T('7z') }] },
      { say: '「金三銀七」：打牌時三和七的萬、筒、條這些中張特別好用，要謹慎保留，也要小心防守。「北仔尾」形容死守尾張、邊張的心態。', speak: '金三銀七：三和七這些中張特別好用，要謹慎保留，也要小心防守。北仔尾，形容死守尾張、邊張的心態。', rows: [{ label: '金三', tiles: T('3m3p3s'), hl: [0, 1, 2] }, { label: '銀七', tiles: T('7m7p7s'), hl: [0, 1, 2] }] },
    ],
  },
  {
    id: 'tips', title: '實用技巧', steps: [
      { say: '開局先打孤張的字牌和么九牌，留下能連成順子的中張。兩張相連、兩頭都能等的搭子最好。', rows: [{ label: '好搭子（兩面）', tiles: T('45m'), groups: [[0, 2, '#35c46b', '等 3、6']] }, { label: '差搭子（邊張）', tiles: T('12m'), groups: [[0, 2, '#ff5252', '只等 3']] }] },
      { say: '別人已經打過的牌，你再打出去他不能胡（這叫「現物」，最安全）。當有人吃碰很多組、看起來快聽牌時，盡量打現物或場上已經出現很多張的牌。', rows: [{ label: '對手牌河', tiles: T('9m2p6z5s') }, { label: '安全牌', tiles: T('9m2p'), hl: [0, 1] }] },
      { say: '遇到不懂的地方，隨時可以問右邊的 AI 軍師；按「軍師代打」，軍師就會幫你打，想自己打時再換回真人就好。', rows: [{ label: '軍師', tiles: T('5z'), groups: [[0, 1, '#e8b84a', '代打']] }] },
    ],
  },
];

// ---------------- 練習題（用規則引擎即時出題、驗證） ----------------
const PRACTICE = [
  { q: '這副牌打哪一張就能聽牌？', hand: '123m456p789s111z22z459m', kind: 'discard' },
  { q: '這副牌聽哪幾張？（全部選出來）', hand: '45m123p456p789s111z22z', kind: 'waits' },
  { q: '這副牌打哪一張就能聽牌？', hand: '234m567m33p78p456s789s5z', kind: 'discard' },
  { q: '這副牌聽哪幾張？（全部選出來）', hand: '1112345678999m123p', kind: 'waits', note: '萬子的「九蓮寶燈」型，一萬到九萬都能胡' },
  { q: '門清、放槍胡牌、單吊紅中，沒有花，東風圈西家，一共幾台？', hand: '123m456m789p234s678s55z', win: 31, kind: 'tai', ctx: { selfDraw: false, seatWind: 2, roundWind: 0 } },
  { q: '門清自摸、清一色、五暗刻的碰碰胡，一共幾台？（閒家、沒有花）', hand: '11122233344455566m', win: 5, kind: 'tai', ctx: { selfDraw: true, seatWind: 1, roundWind: 0 } },
];

export function practiceAnswer(p) {
  const tiles = T(p.hand);
  if (p.kind === 'discard') {
    const c = countsOf(tiles);
    const need = Math.floor(tiles.length / 3);
    return [...new Set(tiles)].filter((t) => { c[t]--; const ok = shanten(c, need) === 0; c[t]++; return ok; });
  }
  if (p.kind === 'waits') return waits(countsOf(tiles), Math.floor(tiles.length / 3));
  if (p.kind === 'tai') {
    const need = 5;
    void need;
    return [scoreHand({ concealed: tiles, melds: [], flowers: [], winTile: p.win, ...p.ctx }).total];
  }
  return [];
}

// ---------------- 畫面 ----------------
let G = null;

export function openGuide(ctx) {
  G = { ctx, li: 0, si: 0, playing: false, token: 0, practice: false, pi: 0 };
  const body = $('#guideBody');
  body.innerHTML = '';
  const list = h('div', { class: 'gd-list' },
    ...LESSONS.map((l, i) => h('button', { class: 'gd-item', 'data-i': i, onclick: () => { G.practice = false; goLesson(i); startPlay(); } }, h('span', { class: 'n' }, String(i + 1)), l.title)),
    h('button', { class: 'gd-item practice', 'data-i': 'p', onclick: () => openPractice(0) }, h('span', { class: 'n' }, '✎'), '練習題'));
  G.stage = h('div', { class: 'gd-stage' });
  G.caption = h('div', { class: 'gd-caption' });
  G.ctrl = h('div', { class: 'gd-ctrl' },
    h('button', { id: 'gdPrev', onclick: () => step(-1) }, '◀ 上一步'),
    h('button', { id: 'gdPlay', class: 'primary', onclick: () => togglePlay() }, '▶ 播放講解'),
    h('button', { id: 'gdNext', onclick: () => step(1) }, '下一步 ▶'),
    h('button', { id: 'gdVoice', onclick: () => { ctx.voice.muted = !ctx.voice.muted; if (ctx.voice.muted) ctx.voice.stop(); $('#gdVoice').textContent = ctx.voice.muted ? '🔇 語音關' : '🔊 語音開'; } }, ctx.voice.muted ? '🔇 語音關' : '🔊 語音開'));
  G.status = h('div', { class: 'gd-status muted small' }, ctx.voice.available ? `語音：${ctx.voice.voiceName}` : '這台電腦沒有中文語音，改用字幕講解');
  body.append(
    h('div', { class: 'gd-head' }, h('h2', {}, '📖 遊戲說明'), h('span', { class: 'muted' }, '台灣 16 張麻將：規則、台數、得分失分、台語口語'),
      h('button', { class: 'gd-back', onclick: () => { stopPlay(); ctx.back(); } }, '⟵ 返回首頁')),
    h('div', { class: 'gd-body' }, list, h('div', { class: 'gd-main' }, G.stage, h('div', { class: 'gd-side' }, G.caption, G.ctrl, G.status))));
  ctx.show();
  goLesson(0);
  // 一進來就開始語音講解
  setTimeout(() => { if (G && !G.practice) startPlay(); }, 700);
}

function goLesson(i) {
  stopPlay();
  G.li = i; G.si = 0;
  $$('.gd-item').forEach((b) => b.classList.toggle('on', b.dataset.i === String(i)));
  renderStep();
}

function renderStep() {
  const L = LESSONS[G.li];
  const st = L.steps[G.si];
  G.caption.className = 'gd-caption';
  G.caption.innerHTML = '';
  G.caption.append(h('div', { class: 'gd-step muted small' }, `${L.title}　${G.si + 1} / ${L.steps.length}`), h('div', {}, st.say));
  G.stage.innerHTML = '';
  fitTiles(Math.max(...st.rows.map((r) => r.tiles.length)));
  st.rows.forEach((row, ri) => {
    const tilesEl = h('div', { class: 'gd-tiles' }, row.tiles.map((t, k) => h('div', {
      class: 'gd-tile' + ((row.hl || []).includes(k) ? ' hl' : '') + ((row.dim || []).includes(k) ? ' dim' : '') + (row.fly === k ? ' fly' : '') + (t < 0 ? ' back' : ''),
      style: { animationDelay: `${ri * 0.25 + k * 0.04}s` },
    }, t >= 0 ? h('img', { src: faceUrl(t), alt: typeName(t) }) : null)));
    const groups = (row.groups || []).map(([s, n, col, text]) => h('div', { class: 'gd-group', style: { '--gc': col, '--gs': s, '--gn': n, animationDelay: `${0.5 + ri * 0.25}s` } }, h('span', {}, text)));
    G.stage.append(h('div', { class: 'gd-row', style: { animationDelay: `${ri * 0.25}s` } }, h('div', { class: 'gd-label' }, row.label), h('div', { class: 'gd-tilewrap' }, tilesEl, ...groups)));
  });
  $('#gdPrev').disabled = G.li === 0 && G.si === 0;
}

function step(d) {
  stopPlay();
  move(d);
}

function move(d) {
  const L = LESSONS[G.li];
  let si = G.si + d, li = G.li;
  if (si >= L.steps.length) { if (li + 1 >= LESSONS.length) { openPractice(0); return false; } li++; si = 0; }
  if (si < 0) { if (li === 0) return false; li--; si = LESSONS[li].steps.length - 1; }
  G.li = li; G.si = si;
  $$('.gd-item').forEach((b) => b.classList.toggle('on', b.dataset.i === String(li)));
  renderStep();
  return true;
}

function startPlay() { if (G && !G.playing) togglePlay(); }

async function togglePlay() {
  if (G.playing) { stopPlay(); return; }
  G.playing = true;
  const token = ++G.token;
  $('#gdPlay').textContent = '⏸ 暫停';
  for (;;) {
    const st = LESSONS[G.li].steps[G.si];
    G.caption.classList.add('speaking');
    if (G.ctx.voice.muted) await new Promise((r) => setTimeout(r, 1500 + st.say.length * 120));
    else await G.ctx.voice.speak(st.speak || st.say);
    G.caption.classList.remove('speaking');
    if (token !== G.token || !G.playing) return;
    await new Promise((r) => setTimeout(r, 600));
    if (token !== G.token || !G.playing) return;
    const lastOfLesson = G.si === LESSONS[G.li].steps.length - 1;
    if (lastOfLesson && G.li === LESSONS.length - 1) { stopPlay(); toast('全部講完了，來做練習題吧！', 'ok'); return; }
    move(1); // 一課講完自動接下一課
  }
}

function stopPlay() {
  if (!G) return;
  G.playing = false;
  G.token++;
  G.ctx.voice.stop();
  const b = $('#gdPlay');
  if (b) b.textContent = '▶ 播放講解';
}

// 牌的大小依舞台寬度調整，一排最多 17 張也放得下
function fitTiles(n) {
  const w = G.stage.clientWidth || 800;
  const tw = Math.max(22, Math.min(46, Math.floor((w - 50) / Math.max(n, 6)) - 3));
  G.stage.style.setProperty('--tw', tw + 'px');
}

// 練習題
function openPractice(i) {
  stopPlay();
  G.practice = true;
  G.pi = (i + PRACTICE.length) % PRACTICE.length;
  $$('.gd-item').forEach((b) => b.classList.toggle('on', b.dataset.i === 'p'));
  const p = PRACTICE[G.pi];
  const tiles = T(p.hand);
  fitTiles(tiles.length);
  const answer = practiceAnswer(p);
  const picked = new Set();
  G.caption.className = 'gd-caption practice';
  G.caption.innerHTML = '';
  G.caption.append(h('div', { class: 'gd-step muted small' }, `練習題 ${G.pi + 1} / ${PRACTICE.length}`), h('div', {}, p.q), p.note ? h('div', { class: 'muted small' }, p.note) : null);
  G.stage.innerHTML = '';
  const result = h('div', { class: 'gd-result' });
  const check = (ok, msg) => {
    result.className = 'gd-result ' + (ok ? 'ok' : 'bad');
    result.textContent = msg;
    G.ctx.voice.stop();
    G.ctx.voice.speak(ok ? '答對了！' : '再想想看。');
  };
  if (p.kind === 'discard') {
    G.stage.append(h('div', { class: 'gd-row' }, h('div', { class: 'gd-label' }, '點一張要打出的牌'),
      h('div', { class: 'gd-tiles pick' }, tiles.map((t) => h('div', { class: 'gd-tile', onclick: () => check(answer.includes(t), answer.includes(t) ? `答對了！打${typeName(t)}之後就聽牌了。` : `打${typeName(t)}還不會聽牌喔。正確答案：${answer.map(typeName).join('或')}。`) }, h('img', { src: faceUrl(t) }))))));
  } else if (p.kind === 'waits') {
    G.stage.append(h('div', { class: 'gd-row' }, h('div', { class: 'gd-label' }, '手牌'), h('div', { class: 'gd-tiles' }, tiles.map((t) => h('div', { class: 'gd-tile' }, h('img', { src: faceUrl(t) }))))));
    const cand = [...new Set([...answer, ...Array.from({ length: 9 }, (_, k) => (tiles[0] < 27 ? Math.floor(tiles[0] / 9) * 9 + k : k))])].sort((a, b) => a - b).slice(0, 12);
    G.stage.append(h('div', { class: 'gd-row' }, h('div', { class: 'gd-label' }, '選出聽的牌'),
      h('div', { class: 'gd-tiles pick' }, cand.map((t) => h('div', { class: 'gd-tile', onclick: (e) => { const el = e.currentTarget; if (picked.has(t)) { picked.delete(t); el.classList.remove('hl'); } else { picked.add(t); el.classList.add('hl'); } } }, h('img', { src: faceUrl(t) })))),
      h('button', { class: 'primary', onclick: () => {
        const ok = picked.size === answer.length && answer.every((t) => picked.has(t));
        check(ok, ok ? `答對了！聽 ${answer.map(typeName).join('、')}。` : `正確答案是：${answer.map(typeName).join('、')}。`);
      } }, '對答案')));
  } else if (p.kind === 'tai') {
    const sc = scoreHand({ concealed: T(p.hand), melds: [], flowers: [], winTile: p.win, ...p.ctx });
    G.stage.append(h('div', { class: 'gd-row' }, h('div', { class: 'gd-label' }, `胡 ${typeName(p.win)}`), h('div', { class: 'gd-tiles' }, T(p.hand).map((t) => h('div', { class: 'gd-tile' + (t === p.win ? ' hl' : '') }, h('img', { src: faceUrl(t) }))))));
    const opts = [...new Set([answer[0], answer[0] - 1, answer[0] + 1, answer[0] + 2, Math.max(0, answer[0] - 2)])].sort((a, b) => a - b);
    G.stage.append(h('div', { class: 'gd-row' }, h('div', { class: 'gd-label' }, '一共幾台？'),
      h('div', { class: 'gd-choices' }, opts.map((n) => h('button', { onclick: () => check(n === answer[0], `${n === answer[0] ? '答對了！' : '不對喔。'}${sc.items.map((x) => `${x.name} ${x.tai} 台`).join('＋')}＝${sc.total} 台。`) }, `${n} 台`)))));
  }
  G.stage.append(result);
  if (!G.ctx.voice.muted) { G.ctx.voice.stop(); G.ctx.voice.speak(p.q); }
  G.stage.append(h('div', { class: 'gd-ctrl' }, h('button', { onclick: () => openPractice(G.pi - 1) }, '◀ 上一題'), h('button', { class: 'primary', onclick: () => openPractice(G.pi + 1) }, '下一題 ▶')));
  void TAI;
}

export { PRACTICE };

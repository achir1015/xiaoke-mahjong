// 牌的定義與牌面圖（SVG，程序繪製）
// 牌種編號：0-8 萬、9-17 筒、18-26 條、27-30 東南西北、31-33 中發白、34-41 春夏秋冬梅蘭竹菊
// 實體牌編號（0-143）：0-135 每種 4 張（id >> 2 = 牌種），136-143 八張花牌
export const NUM_TYPES = 34;
export const FLOWER0 = 34;
export const tileType = (id) => (id < 136 ? id >> 2 : FLOWER0 + (id - 136));
export const isFlowerType = (t) => t >= FLOWER0;
export const isHonor = (t) => t >= 27 && t < FLOWER0;
export const isDragon = (t) => t >= 31 && t <= 33;
export const isWind = (t) => t >= 27 && t <= 30;
export const suitOf = (t) => (t < 27 ? Math.floor(t / 9) : 3);
export const rankOf = (t) => (t < 27 ? (t % 9) + 1 : 0);

export const SUIT_NAMES = ['萬', '筒', '條'];
export const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
export const WIND_NAMES = ['東', '南', '西', '北'];
const HONOR_NAMES = ['東風', '南風', '西風', '北風', '紅中', '青發', '白板'];
const FLOWER_NAMES = ['春', '夏', '秋', '冬', '梅', '蘭', '竹', '菊'];

export function typeName(t) {
  if (t < 27) return CN_NUM[t % 9] + SUIT_NAMES[Math.floor(t / 9)];
  if (t < FLOWER0) return HONOR_NAMES[t - 27];
  return FLOWER_NAMES[t - FLOWER0];
}
export const tileName = (id) => typeName(tileType(id));
// 花牌對應的座位（春梅＝東、夏蘭＝南、秋竹＝西、冬菊＝北）
export const flowerSeat = (t) => (t - FLOWER0) % 4;
// 唸牌（語音）：「一筒」唸成「一餅」比較口語，但台灣多數人說「筒」，照字唸即可
export const typeSpeech = (t) => (t === 31 ? '紅中' : t === 32 ? '發財' : t === 33 ? '白板' : typeName(t));

// 文字代碼（給軍師、紀錄用）：1m 2p 3s E S W N C F P f1~f8
export function typeCode(t) {
  if (t < 27) return `${(t % 9) + 1}${'mps'[Math.floor(t / 9)]}`;
  if (t < FLOWER0) return ['E', 'S', 'W', 'N', 'C', 'F', 'P'][t - 27];
  return 'f' + (t - FLOWER0 + 1);
}

// ---------------- 牌面 SVG ----------------
const W = 60, H = 80;
const RED = '#c8102e', GREEN = '#0f7a3a', BLUE = '#1d3f8f', BLACK = '#1b1b1b';
const KAI = `font-family="DFKai-SB, 'BiauKai', 'Kaiti TC', 'STKaiti', KaiTi, serif" font-weight="700"`;

function txt(x, y, size, color, s, extra = '') {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="middle" dominant-baseline="central" ${KAI} ${extra}>${s}</text>`;
}

// 筒：圓圈位置（以 60×80 為準）
const DOT_POS = {
  1: [[30, 40]],
  2: [[30, 22], [30, 58]],
  3: [[15, 16], [30, 40], [45, 64]],
  4: [[17, 22], [43, 22], [17, 58], [43, 58]],
  5: [[16, 18], [44, 18], [30, 40], [16, 62], [44, 62]],
  6: [[19, 15], [41, 15], [19, 42], [41, 42], [19, 64], [41, 64]],
  7: [[13, 12], [30, 21], [47, 30], [19, 47], [41, 47], [19, 66], [41, 66]],
  8: [[19, 11], [41, 11], [19, 30], [41, 30], [19, 49], [41, 49], [19, 68], [41, 68]],
  9: [[14, 15], [30, 15], [46, 15], [14, 40], [30, 40], [46, 40], [14, 65], [30, 65], [46, 65]],
};
const DOT_COL = {
  1: [RED], 2: [GREEN, BLUE], 3: [BLUE, RED, GREEN], 4: [BLUE, GREEN, GREEN, BLUE], 5: [BLUE, GREEN, RED, GREEN, BLUE],
  6: [GREEN, GREEN, RED, RED, RED, RED], 7: [GREEN, GREEN, GREEN, RED, RED, RED, RED], 8: Array(8).fill(BLUE), 9: [BLUE, BLUE, BLUE, RED, RED, RED, GREEN, GREEN, GREEN],
};
function dot(x, y, r, col) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/><circle cx="${x}" cy="${y}" r="${r * 0.72}" fill="#fffdf6"/><circle cx="${x}" cy="${y}" r="${r * 0.5}" fill="${col}"/><circle cx="${x}" cy="${y}" r="${r * 0.2}" fill="#fffdf6"/>`;
}
function dotsFace(n) {
  if (n === 1) {
    let s = `<circle cx="30" cy="40" r="22" fill="${GREEN}"/><circle cx="30" cy="40" r="18" fill="#fffdf6"/>`;
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      s += `<circle cx="${30 + Math.cos(a) * 14}" cy="${40 + Math.sin(a) * 14}" r="2.6" fill="${k % 2 ? BLUE : GREEN}"/>`;
    }
    s += `<circle cx="30" cy="40" r="9" fill="${RED}"/><circle cx="30" cy="40" r="4" fill="#fffdf6"/>`;
    return s;
  }
  const r = n <= 2 ? 12 : n <= 4 ? 10 : n <= 6 ? 8.6 : n === 9 ? 7.6 : 7.4;
  return DOT_POS[n].map(([x, y], i) => dot(x, y, r, DOT_COL[n][i])).join('');
}

// 條：竹子
function stick(x, y, len, col) {
  const w = 6;
  return `<g><rect x="${x - w / 2}" y="${y - len / 2}" width="${w}" height="${len}" rx="3" fill="${col}"/>` +
    `<rect x="${x - w / 2 - 1}" y="${y - 1.5}" width="${w + 2}" height="3" rx="1.5" fill="${col}"/>` +
    `<rect x="${x - 0.8}" y="${y - len / 2 + 2}" width="1.6" height="${len - 4}" fill="#fffdf6" opacity="0.55"/></g>`;
}
const BAM_POS = {
  2: [[30, 22], [30, 58]],
  3: [[30, 22], [18, 58], [42, 58]],
  4: [[18, 22], [42, 22], [18, 58], [42, 58]],
  5: [[16, 22], [44, 22], [30, 40], [16, 58], [44, 58]],
  6: [[15, 22], [30, 22], [45, 22], [15, 58], [30, 58], [45, 58]],
  7: [[30, 13], [15, 40], [30, 40], [45, 40], [15, 66], [30, 66], [45, 66]],
  8: [[13, 22], [24, 20], [36, 20], [47, 22], [13, 58], [24, 60], [36, 60], [47, 58]],
  9: [[15, 14], [30, 14], [45, 14], [15, 40], [30, 40], [45, 40], [15, 66], [30, 66], [45, 66]],
};
function bamFace(n) {
  if (n === 1) {
    // 孔雀（一條）
    return `<g>
      <path d="M30 70 C18 62 14 48 22 38 C16 30 20 18 30 16 C40 18 44 30 38 38 C46 48 42 62 30 70 Z" fill="${GREEN}"/>
      <path d="M30 66 C24 58 24 48 30 42 C36 48 36 58 30 66 Z" fill="#2fa65a"/>
      <circle cx="30" cy="54" r="4" fill="${BLUE}"/><circle cx="30" cy="54" r="1.8" fill="#f4c430"/>
      <circle cx="22" cy="46" r="3" fill="${BLUE}"/><circle cx="38" cy="46" r="3" fill="${BLUE}"/>
      <circle cx="30" cy="20" r="6" fill="${RED}"/><path d="M35 19 L42 17 L36 23 Z" fill="#e8a020"/><circle cx="31.5" cy="18.5" r="1.4" fill="#fff"/>
      <path d="M28 14 l-3 -7 M30 14 v-8 M32 14 l3 -7" stroke="${RED}" stroke-width="1.5"/>
      <path d="M26 70 l-3 6 M34 70 l3 6" stroke="#e8a020" stroke-width="2"/></g>`;
  }
  const len = n <= 6 ? 26 : n === 8 ? 26 : 20;
  return BAM_POS[n].map(([x, y], i) => {
    let col = GREEN;
    if ((n === 5 || n === 7) && i === (n === 5 ? 2 : 0)) col = RED;
    if (n === 9 && i % 3 === 1) col = RED;
    if (n === 8) {
      // 八條：上下兩組呈 W 與 M 形
      const tilt = [-18, 18, -18, 18][i % 4] * (i < 4 ? 1 : -1);
      return `<g transform="rotate(${tilt} ${x} ${y})">${stick(x, y, len, col)}</g>`;
    }
    return stick(x, y, len, col);
  }).join('');
}

function charFace(n) {
  return txt(30, 22, 30, BLACK, CN_NUM[n - 1]) + txt(30, 56, 32, RED, '萬');
}

function honorFace(t) {
  if (t <= 30) return txt(30, 41, 46, BLACK, WIND_NAMES[t - 27]);
  if (t === 31) return txt(30, 41, 48, RED, '中');
  if (t === 32) return txt(30, 41, 46, GREEN, '發');
  return `<rect x="10" y="12" width="40" height="56" rx="4" fill="none" stroke="${BLUE}" stroke-width="4"/><rect x="16" y="18" width="28" height="44" rx="2" fill="none" stroke="${BLUE}" stroke-width="1.6"/>`;
}

const FLOWER_ART = [
  ['#e05a7a', '#f9c8d4'], ['#d8542a', '#ffd27a'], ['#c88a1a', '#f4c430'], ['#5a7ab0', '#d8e6ff'],
  ['#c8325a', '#ffd0dc'], ['#7a4ab0', '#e0ccff'], ['#2f8a4a', '#bfe6c8'], ['#d8a018', '#ffe9a0'],
];
function flowerFace(t) {
  const k = t - FLOWER0;
  const [c1, c2] = FLOWER_ART[k];
  let s = '';
  // 小花
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    s += `<ellipse cx="${44 + Math.cos(a) * 5}" cy="${62 + Math.sin(a) * 5}" rx="4.4" ry="3" transform="rotate(${(a * 180) / Math.PI} ${44 + Math.cos(a) * 5} ${62 + Math.sin(a) * 5})" fill="${c2}" stroke="${c1}" stroke-width="0.8"/>`;
  }
  s += `<circle cx="44" cy="62" r="2.4" fill="${c1}"/>`;
  s += txt(30, 32, 36, c1, FLOWER_NAMES[k]);
  s += `<text x="15" y="64" font-size="16" fill="${k < 4 ? RED : BLUE}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="700">${(k % 4) + 1}</text>`;
  return s;
}

function faceInner(t) {
  if (t < 9) return charFace(t + 1);
  if (t < 18) return dotsFace(t - 8);
  if (t < 27) return bamFace(t - 17);
  if (t < FLOWER0) return honorFace(t);
  return flowerFace(t);
}

const cache = new Map();
export function faceSvg(t) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${faceInner(t)}</svg>`;
}
export function faceUrl(t) {
  let u = cache.get(t);
  if (!u) { u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(faceSvg(t)); cache.set(t, u); }
  return u;
}

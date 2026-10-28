// 3D 牌桌：立體麻將牌（象牙白牌面＋綠色牌背）、牌河、吃碰槓、花牌、牌牆、中央資訊盤
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { tileType, faceUrl, WIND_NAMES } from './tiles.js';

const TW = 3.2, TH = 4.3, TD = 2.3;   // 牌寬、牌高、牌厚
const GREEN_D = TD * 0.38;
const L = 55;                          // 桌面半寬

// ---------------- 共用幾何與材質 ----------------
function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const BEV = 0.16;
function slab(depth) {
  const g = new THREE.ExtrudeGeometry(roundedRect(TW - BEV * 2, TH - BEV * 2, 0.35), { depth: Math.max(0.01, depth - BEV * 2), bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, BEV);
  return g;
}
const GEO = {
  green: (() => { const g = slab(GREEN_D); g.translate(0, 0, -TD / 2); return g; })(),
  ivory: (() => { const g = slab(TD - GREEN_D + 0.02); g.translate(0, 0, -TD / 2 + GREEN_D - 0.02); return g; })(),
  face: new THREE.PlaneGeometry(TW * 0.9, TH * 0.9),
};
const MAT = {
  green: new THREE.MeshStandardMaterial({ color: 0x0f7a45, roughness: 0.35, metalness: 0.05 }),
  ivory: new THREE.MeshStandardMaterial({ color: 0xf6f0e1, roughness: 0.4 }),
};
const highlightMat = MAT.ivory.clone(); highlightMat.color.set(0xfff2a8); highlightMat.emissive = new THREE.Color(0x4a3a00);
const hintMat = MAT.ivory.clone(); hintMat.color.set(0xc8f5d0); hintMat.emissive = new THREE.Color(0x0a3a14);
const waitMat = MAT.ivory.clone(); waitMat.color.set(0xd8e8ff); waitMat.emissive = new THREE.Color(0x0a1a40);

const faceMats = new Map();
function faceMat(t) {
  let m = faceMats.get(t);
  if (m) return m;
  const cv = document.createElement('canvas');
  cv.width = 240; cv.height = 320;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const img = new Image();
  img.onload = () => { cv.getContext('2d').drawImage(img, 0, 0, 240, 320); tex.needsUpdate = true; };
  img.src = faceUrl(t);
  m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2 });
  faceMats.set(t, m);
  return m;
}

function makeTile(t) {
  const g = new THREE.Group();
  const green = new THREE.Mesh(GEO.green, MAT.green);
  const ivory = new THREE.Mesh(GEO.ivory, MAT.ivory);
  g.add(green, ivory);
  if (t != null && t >= 0) {
    const f = new THREE.Mesh(GEO.face, faceMat(t));
    f.position.z = TD / 2 + 0.012;
    g.add(f);
  }
  g.userData.ivory = ivory;
  return g;
}

// 座位（相對位置 k：0 我、1 下家（右）、2 對家、3 上家（左））的旋轉角
const seatAngle = (k) => (k * Math.PI) / 2;
const Q_STAND = new THREE.Quaternion();
const Q_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const Q_DOWN = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI));
const Q_MINE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.32, 0, 0));
const Q_SIDE_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2)); // 橫放（被吃碰的那張）

export class Table3D {
  constructor(el, { onTileClick, onTileHover } = {}) {
    this.el = el;
    this.onTileClick = onTileClick;
    this.onTileHover = onTileHover;
    this.objs = new Map();     // key → Group
    this.mySeat = 0;
    this.selected = -1;
    this.hover = -1;
    this.interactive = false;
    this.marks = { hint: -1, waits: new Set() };
    this.viewMode = 'tilt';
    this.initScene();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  initScene() {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.el.append(r.domElement);
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10221a);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 1000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.minDistance = 60; this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.enablePan = false;
    this.setView('tilt');

    scene.add(new THREE.HemisphereLight(0xfff8ee, 0x1a3324, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-30, 90, 60);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffe9c8, 0.45);
    fill.position.set(40, 40, -50);
    scene.add(fill);

    // 桌布（絨布紋理）
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const c = cv.getContext('2d');
    const grd = c.createRadialGradient(256, 256, 40, 256, 256, 360);
    grd.addColorStop(0, '#1f7a4f'); grd.addColorStop(1, '#0f4a30');
    c.fillStyle = grd; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; c.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    c.strokeStyle = 'rgba(255,230,160,0.18)'; c.lineWidth = 3; c.strokeRect(60, 60, 392, 392);
    const felt = new THREE.CanvasTexture(cv);
    felt.colorSpace = THREE.SRGBColorSpace;
    const table = new THREE.Mesh(new THREE.PlaneGeometry(L * 2, L * 2), new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2;
    scene.add(table);
    // 木框
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3f1f, roughness: 0.55 });
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(L * 2 + 8, 3, 4), wood);
      const a = seatAngle(k);
      b.position.set(Math.sin(a) * (L + 2), 1.2, Math.cos(a) * (L + 2));
      b.rotation.y = a;
      scene.add(b);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -6;
    scene.add(floor);

    // 中央資訊盤
    this.centerCv = document.createElement('canvas');
    this.centerCv.width = this.centerCv.height = 512;
    this.centerTex = new THREE.CanvasTexture(this.centerCv);
    this.centerTex.colorSpace = THREE.SRGBColorSpace;
    this.center = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 22), [
      new THREE.MeshStandardMaterial({ color: 0x1a1410 }), new THREE.MeshStandardMaterial({ color: 0x1a1410 }),
      new THREE.MeshStandardMaterial({ map: this.centerTex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x1a1410 }),
      new THREE.MeshStandardMaterial({ color: 0x1a1410 }), new THREE.MeshStandardMaterial({ color: 0x1a1410 }),
    ]);
    this.center.position.y = 0.6;
    scene.add(this.center);

    // 最後打出的牌：標示箭頭
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2, 16), new THREE.MeshStandardMaterial({ color: 0xff4a3a, emissive: 0x801010 }));
    cone.rotation.x = Math.PI;
    this.lastMark = cone;
    cone.visible = false;
    scene.add(cone);

    // 牌牆
    this.wallGroup = new THREE.Group();
    scene.add(this.wallGroup);
    this.wallMeshes = [];
    const stackGeo = new THREE.BoxGeometry(TW * 0.95, TD * 0.97, TH);
    for (let i = 0; i < 144; i++) {
      const m = new THREE.Mesh(stackGeo, [MAT.ivory, MAT.ivory, MAT.green, MAT.ivory, MAT.ivory, MAT.ivory]);
      const stack = Math.floor(i / 2), layer = i % 2;
      const side = Math.floor(stack / 18), pos = stack % 18;
      const a = seatAngle(side);
      const lx = (pos - 8.5) * TW, lz = 33.5;
      m.position.set(lx * Math.cos(a) + lz * Math.sin(a), TD / 2 + layer * TD, -lx * Math.sin(a) + lz * Math.cos(a));
      m.rotation.y = a;
      this.wallGroup.add(m);
      this.wallMeshes.push(m);
    }

    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    const dom = r.domElement;
    dom.addEventListener('pointermove', (e) => this.onPointer(e, false));
    dom.addEventListener('pointerdown', (e) => { this.downAt = [e.clientX, e.clientY]; });
    dom.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.downAt) return;
      if (Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 6) return;
      this.onPointer(e, true);
    });
    dom.addEventListener('pointerleave', () => this.setHover(-1));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.resize();
  }

  setView(v) {
    this.viewMode = v;
    const pos = v === 'top' ? [0, 150, 18] : v === 'low' ? [0, 58, 104] : [0, 92, 86];
    this.camera.position.set(...pos);
    this.controls.target.set(0, 0, v === 'low' ? 14 : 10);
    this.controls.update();
  }

  resize() {
    const w = this.el.clientWidth || 800, h = this.el.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    // 視窗較窄時拉遠一點，整張桌子才看得到
    this.camera.fov = w / h < 1.25 ? 48 : 38;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- 擺放 ----------------
  // 由「座位本地座標」換成世界座標
  place(obj, k, lx, ly, lz, q, extraRotY = 0) {
    const a = seatAngle(k);
    const cos = Math.cos(a), sin = Math.sin(a);
    const target = new THREE.Vector3(lx * cos + lz * sin, ly, -lx * sin + lz * cos);
    const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + extraRotY).multiply(q);
    obj.userData.tp = target;
    obj.userData.tq = qq;
    if (!obj.userData.placed) {
      obj.position.copy(obj.userData.from || target);
      obj.quaternion.copy(obj.userData.fromQ || qq);
      obj.userData.placed = true;
    }
  }

  getTile(key, t, from) {
    let o = this.objs.get(key);
    if (o && o.userData.t !== t) { this.scene.remove(o); o = null; }
    if (!o) {
      o = makeTile(t);
      o.userData.t = t;
      o.userData.key = key;
      if (from) { o.userData.from = from.p; o.userData.fromQ = from.q; }
      this.scene.add(o);
      this.objs.set(key, o);
    }
    o.userData.alive = true;
    return o;
  }

  rel(seat) { return (seat - this.mySeat + 4) % 4; }

  // 主要的畫面更新：view 是 Hand.view(座位) 的資料
  render(view, mySeat) {
    this.mySeat = mySeat < 0 ? 0 : mySeat;
    this.view = view;
    for (const o of this.objs.values()) o.userData.alive = false;
    // 先記住現有實體牌的位置（讓新出現的牌從原本的地方飛過去）
    const prevPos = new Map();
    for (const [key, o] of this.objs) prevPos.set(key, { p: o.position.clone(), q: o.quaternion.clone() });
    const handOrigin = (k) => { const a = seatAngle(k); return { p: new THREE.Vector3(Math.sin(a) * 44, 3, Math.cos(a) * 44), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a) }; };

    view.players.forEach((pl, s) => {
      const k = this.rel(s);
      const mine = s === mySeat;
      const front = mine || (this.showAll && k === 0); // 下方那一家立著給人看
      const meldsW = pl.melds.reduce((a, m) => a + (m.tiles.length === 4 ? 4 : 3) * TW + 1.2, 0);
      // 手牌
      const n = pl.count;
      const hasDrawn = pl.drawn !== -1 && n % 3 === 2;
      const handW = n * TW + (hasDrawn ? 1.2 : 0);
      let x0 = -handW / 2 - meldsW / 2 + TW / 2;
      const ids = pl.hand ? pl.hand.slice() : null;
      // 剛摸的牌放最右邊、隔開一點
      let order = ids;
      if (ids && hasDrawn && pl.drawn >= 0 && ids.includes(pl.drawn)) {
        order = ids.filter((x) => x !== pl.drawn).sort((a, b) => tileType(a) - tileType(b) || a - b);
        order.push(pl.drawn);
      } else if (ids) order = ids.slice().sort((a, b) => tileType(a) - tileType(b) || a - b);
      const open = !!ids && (mine || !!view.result || this.showAll);
      for (let i = 0; i < n; i++) {
        const gap = hasDrawn && i === n - 1 ? 1.2 : 0;
        const x = x0 + i * TW + gap;
        if (open) {
          const id = order[i];
          const o = this.getTile('t' + id, tileType(id), prevPos.get('t' + id) || (mine ? { p: new THREE.Vector3(0, 6, 20), q: Q_MINE } : handOrigin(k)));
          o.userData.hand = mine;
          const up = mine && id === this.selected ? 1.4 : mine && id === this.hover && this.interactive ? 0.5 : 0;
          if (front) this.place(o, k, x, TH / 2 + up, 45 - up * 0.3, Q_MINE);
          else this.place(o, k, x, TD / 2, 45, view.result ? Q_UP : Q_STAND);
          o.userData.ivory.material = mine && this.marks.hint === tileType(id) ? hintMat : mine && id === this.selected ? highlightMat : MAT.ivory;
        } else {
          const o = this.getTile(`h${s}-${i}`, -1, prevPos.get(`h${s}-${i}`));
          o.userData.hand = false;
          this.place(o, k, x, TH / 2, 45, Q_STAND);
        }
      }
      // 吃碰槓：放在手牌右邊
      let mx = handW / 2 - meldsW / 2 + 1.4 + TW / 2 + (n ? 0 : 0);
      mx = Math.max(mx, x0 + n * TW + 1.4 + (hasDrawn ? 1.2 : 0));
      pl.melds.forEach((m, mi) => {
        m.tiles.forEach((id, j) => {
          const key = id >= 0 ? 't' + id : `k${s}-${mi}-${j}`;
          const hidden = id < 0 || (m.concealed && (j === 0 || j === 3) && !open);
          const o = this.getTile(key, id >= 0 ? tileType(id) : -1, prevPos.get(key) || this.riverPosOf(id));
          o.userData.hand = false;
          // 暗槓：兩頭蓋著
          const faceDown = id < 0 || (m.concealed && (j === 0 || j === 3));
          this.place(o, k, mx + j * TW, TD / 2, 46.5, faceDown ? Q_DOWN : Q_UP);
          void hidden;
        });
        mx += m.tiles.length * TW + 1.2;
      });
      // 花牌：手牌左前方
      pl.flowers.forEach((id, i) => {
        const o = this.getTile('t' + id, tileType(id), prevPos.get('t' + id) || handOrigin(k));
        o.userData.hand = false;
        const fx = -30 + (i % 8) * (TW * 0.82);
        this.place(o, k, fx, TD / 2 * 0.8, 38.5, Q_UP);
        o.scale.setScalar(0.8);
      });
      // 牌河：每排 8 張
      pl.river.forEach((id, i) => {
        const row = Math.floor(i / 8), col = i % 8;
        const o = this.getTile('t' + id, tileType(id), prevPos.get('t' + id) || handOrigin(k));
        o.userData.hand = false;
        o.scale.setScalar(1);
        this.place(o, k, (col - 3.5) * TW, TD / 2, 13.5 + row * TH, Q_UP);
      });
    });

    // 移除不在場上的牌
    for (const [key, o] of this.objs) if (!o.userData.alive) { this.scene.remove(o); this.objs.delete(key); }

    // 最後打出的牌
    const ld = view.lastDiscard;
    const ldObj = ld && this.objs.get('t' + ld.tile);
    if (ldObj && view.players[ld.seat].river.includes(ld.tile)) {
      this.lastMark.visible = true;
      this.lastMarkTarget = ldObj;
    } else this.lastMark.visible = false;

    // 牌牆（從頭開始拿）
    const left = view.wallLen;
    const startStack = ((view.dealer * 18 + (view.dice ? view.dice[0] + view.dice[1] + view.dice[2] : 0)) * 2) % 144;
    const taken = 144 - left;
    for (let i = 0; i < 144; i++) {
      const idx = (i - startStack + 144) % 144;
      this.wallMeshes[i].visible = idx >= taken;
    }
    this.drawCenter(view);
  }

  riverPosOf() { return null; }

  drawCenter(view) {
    const c = this.centerCv.getContext('2d');
    const S = 512;
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#1d1a16'; c.fillRect(0, 0, S, S);
    c.strokeStyle = '#c9a24a'; c.lineWidth = 6; c.strokeRect(10, 10, S - 20, S - 20);
    // 四邊：各家的門風（自己在下方）
    const font = (sz) => `bold ${sz}px "Microsoft JhengHei", "PingFang TC", sans-serif`;
    for (let s = 0; s < 4; s++) {
      const k = this.rel(s);
      const w = view.players[s].seatWind;
      c.save();
      c.translate(S / 2, S / 2);
      c.rotate(-k * Math.PI / 2);
      const isTurn = view.turn === s && !view.result;
      c.fillStyle = isTurn ? '#ffd24a' : s === view.dealer ? '#ff6a4a' : '#e8e0c8';
      c.font = font(74);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(WIND_NAMES[w], 0, 182);
      if (isTurn) { c.fillStyle = '#ffd24a'; c.fillRect(-60, 228, 120, 10); }
      if (s === view.dealer) { c.font = font(30); c.fillStyle = '#ff6a4a'; c.fillText('莊', 78, 182); }
      c.restore();
    }
    c.fillStyle = '#e8c86a'; c.font = font(54); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`${WIND_NAMES[view.roundWind]}風圈`, S / 2, S / 2 - 46);
    c.fillStyle = '#ffffff'; c.font = font(40);
    c.fillText(`剩 ${view.remaining} 張`, S / 2, S / 2 + 22);
    if (view.streak) { c.fillStyle = '#ff9a7a'; c.font = font(30); c.fillText(`連 ${view.streak} 拉 ${view.streak}`, S / 2, S / 2 + 72); }
    this.centerTex.needsUpdate = true;
    // 讓「自己」的那一邊朝下
    this.center.rotation.y = 0;
  }

  // ---------------- 互動 ----------------
  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hands = [...this.objs.values()].filter((o) => o.userData.hand);
    const hit = this.ray.intersectObjects(hands, true)[0];
    if (!hit) return -1;
    let o = hit.object;
    while (o && !o.userData.key) o = o.parent;
    return o ? Number(String(o.userData.key).slice(1)) : -1;
  }

  onPointer(e, click) {
    if (!this.view) return;
    const id = this.pick(e);
    if (click) { if (id >= 0 && this.onTileClick) this.onTileClick(id); return; }
    this.setHover(this.interactive ? id : -1);
    this.renderer.domElement.style.cursor = id >= 0 && this.interactive ? 'pointer' : '';
  }

  setHover(id) {
    if (id === this.hover) return;
    this.hover = id;
    if (this.onTileHover) this.onTileHover(id);
    if (this.view) this.render(this.view, this.mySeat);
  }

  setSelected(id) { this.selected = id; if (this.view) this.render(this.view, this.mySeat); }
  setHint(t) { this.marks.hint = t; if (this.view) this.render(this.view, this.mySeat); }
  setInteractive(v) { this.interactive = v; if (!v) this.hover = -1; }

  // 手牌在畫面上的位置（給 DOM 浮層定位用）
  screenOf(id) {
    const o = this.objs.get('t' + id);
    if (!o) return null;
    const v = o.userData.tp.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, ((now - (this.last || now)) / 1000) || 0.016);
    this.last = now;
    const k = 1 - Math.exp(-dt * 14);
    for (const o of this.objs.values()) {
      const { tp, tq } = o.userData;
      if (!tp) continue;
      o.position.lerp(tp, k);
      o.quaternion.slerp(tq, k);
    }
    if (this.lastMark.visible && this.lastMarkTarget) {
      const p = this.lastMarkTarget.position;
      this.lastMark.position.set(p.x, p.y + 3.2 + Math.sin(now / 220) * 0.5, p.z);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

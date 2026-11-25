/**
 * src/scene/textures3d.js — High-Resolution Procedural PBR Albedo, Normal & Roughness Textures
 * Uses Sobel height-to-normal conversion so thatch, bamboo weave, tin roofs, bark & terrain
 * show crisp directional lighting relief matching photoreal tabletop fidelity.
 */

import * as THREE from "three";

const _cache = new Map();

function seededNoise(x, y, seed = 1) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { canvas: c, ctx: c.getContext("2d") };
}

function makeTex(canvas, { key, srgb = true, repeatX = 1, repeatY = 1, wrap = THREE.RepeatWrapping, anisotropy = 8 } = {}) {
  if (key && _cache.has(key)) return _cache.get(key);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  if (key) _cache.set(key, tex);
  return tex;
}

/** Converts a grayscale height canvas into a crisp tangent-space RGB NormalMap */
function heightCanvasToNormalTex(heightCanvas, strength = 2.6, opts = {}) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const hCtx = heightCanvas.getContext("2d");
  const src = hCtx.getImageData(0, 0, w, h)?.data;
  const out = makeCanvas(w, h);
  if (!src) {
    out.ctx.fillStyle = "rgb(128,128,255)";
    out.ctx.fillRect(0, 0, w, h);
    return makeTex(out.canvas, { ...opts, srgb: false });
  }

  const dstImg = out.ctx.createImageData(w, h);
  const dst = dstImg.data;
  const sample = (x, y) => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dY = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      let nx = -dX;
      let ny = -dY;
      let nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }
  out.ctx.putImageData(dstImg, 0, 0);
  return makeTex(out.canvas, { ...opts, srgb: false });
}

/** High-detail woven split-bamboo matting (512x512 albedo + tangent normal map) */
export function getBambooWallMaps(isDay = false) {
  const key = `bamboo_wall_hi_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const S = 512;
  const col = makeCanvas(S, S);
  const hgt = makeCanvas(S, S);
  const cctx = col.ctx;
  const hctx = hgt.ctx;

  cctx.fillStyle = isDay ? "#7d643d" : "#3b2f1f";
  cctx.fillRect(0, 0, S, S);
  hctx.fillStyle = "#303030";
  hctx.fillRect(0, 0, S, S);

  const step = 16;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const alt = ((x / step + y / step) % 2) === 0;
      const jit = (seededNoise(x, y, 5) - 0.5) * 22;
      const r = (isDay ? (alt ? 182 : 146) : (alt ? 114 : 86)) + jit;
      const g = (isDay ? (alt ? 152 : 120) : (alt ? 92 : 68)) + jit * 0.85;
      const b = (isDay ? (alt ? 104 : 80) : (alt ? 60 : 44)) + jit * 0.65;

      cctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      cctx.fillRect(x + 1, y + 1, step - 2, step - 2);

      // Rounded split-bamboo strip height gradient for crisp normal relief
      const grad = alt
        ? hctx.createLinearGradient(x, y, x, y + step)
        : hctx.createLinearGradient(x, y, x + step, y);
      grad.addColorStop(0, "#4a4a4a");
      grad.addColorStop(0.5, alt ? "#e8e8e8" : "#b8b8b8");
      grad.addColorStop(1, "#4a4a4a");
      hctx.fillStyle = grad;
      hctx.fillRect(x + 1, y + 1, step - 2, step - 2);

      // Fine bamboo vascular striations
      cctx.strokeStyle = isDay ? "rgba(56,38,18,0.22)" : "rgba(18,12,8,0.32)";
      cctx.lineWidth = 1;
      for (let k = 4; k < step - 2; k += 4) {
        cctx.beginPath();
        if (alt) {
          cctx.moveTo(x + 1, y + k);
          cctx.lineTo(x + step - 1, y + k);
        } else {
          cctx.moveTo(x + k, y + 1);
          cctx.lineTo(x + k, y + step - 1);
        }
        cctx.stroke();
      }
    }
  }

  const maps = {
    map: makeTex(col.canvas, { key: `${key}_c`, srgb: true, repeatX: 2.2, repeatY: 1.6 }),
    normalMap: heightCanvasToNormalTex(hgt.canvas, 2.4, { key: `${key}_n`, repeatX: 2.2, repeatY: 1.6 }),
  };
  _cache.set(key, maps);
  return maps;
}

/** High-detail layered rice-straw thatch (512x512 albedo + tangent normal map) */
export function getThatchMaps(isDay = false) {
  const key = `thatch_hi_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const S = 512;
  const col = makeCanvas(S, S);
  const hgt = makeCanvas(S, S);
  const cctx = col.ctx;
  const hctx = hgt.ctx;

  cctx.fillStyle = isDay ? "#856d42" : "#353124";
  cctx.fillRect(0, 0, S, S);
  hctx.fillStyle = "#484848";
  hctx.fillRect(0, 0, S, S);

  for (let row = 0; row < 10; row++) {
    const yBase = row * (S / 10);
    cctx.fillStyle = isDay ? "rgba(42,30,14,0.34)" : "rgba(10,12,10,0.48)";
    cctx.fillRect(0, yBase + S / 10 - 6, S, 6);
    hctx.fillStyle = "#222222";
    hctx.fillRect(0, yBase + S / 10 - 5, S, 5);

    for (let i = 0; i < 420; i++) {
      const x = seededNoise(i, row, 11) * S;
      const len = 30 + seededNoise(i, row, 19) * 34;
      const sway = (seededNoise(i, row, 27) - 0.5) * 9;
      const shade = seededNoise(i, row, 31);
      const r = isDay ? 142 + shade * 78 : 58 + shade * 46;
      const g = isDay ? 118 + shade * 68 : 54 + shade * 40;
      const b = isDay ? 72 + shade * 40 : 40 + shade * 28;

      cctx.strokeStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      cctx.lineWidth = 1.9;
      cctx.beginPath();
      cctx.moveTo(x, yBase);
      cctx.lineTo(x + sway, yBase + len);
      cctx.stroke();

      const bv = (95 + shade * 150) | 0;
      hctx.strokeStyle = `rgb(${bv},${bv},${bv})`;
      hctx.lineWidth = 2.0;
      hctx.beginPath();
      hctx.moveTo(x, yBase);
      hctx.lineTo(x + sway, yBase + len);
      hctx.stroke();
    }
  }

  const maps = {
    map: makeTex(col.canvas, { key: `${key}_c`, srgb: true, repeatX: 2.4, repeatY: 1.8 }),
    normalMap: heightCanvasToNormalTex(hgt.canvas, 3.0, { key: `${key}_n`, repeatX: 2.4, repeatY: 1.8 }),
  };
  _cache.set(key, maps);
  return maps;
}

/** Weathered corrugated sheet-metal roof texture with tangent normal map */
export function getCorrugatedTinMaps() {
  const key = "tin_roof_hi";
  if (_cache.has(key)) return _cache.get(key);

  const S = 512;
  const col = makeCanvas(S, S);
  const hgt = makeCanvas(S, S);
  const cctx = col.ctx;
  const hctx = hgt.ctx;

  for (let x = 0; x < S; x++) {
    const wave = Math.sin((x / S) * Math.PI * 2 * 24) * 0.5 + 0.5;
    const rustPatch = seededNoise(Math.floor(x / 12), 4, 7) > 0.76 ? 18 : 0;
    const r = 132 + wave * 48 + rustPatch;
    const g = 144 + wave * 50 + rustPatch * 0.3;
    const b = 158 + wave * 52 - rustPatch * 0.4;
    cctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    cctx.fillRect(x, 0, 1, S);

    const hv = (40 + wave * 205) | 0;
    hctx.fillStyle = `rgb(${hv},${hv},${hv})`;
    hctx.fillRect(x, 0, 1, S);
  }

  for (let y = 128; y < S; y += 128) {
    cctx.fillStyle = "rgba(42, 46, 52, 0.48)";
    cctx.fillRect(0, y, S, 4);
    hctx.fillStyle = "#181818";
    hctx.fillRect(0, y, S, 4);
  }

  const maps = {
    map: makeTex(col.canvas, { key: `${key}_c`, srgb: true, repeatX: 2.0, repeatY: 1.5 }),
    normalMap: heightCanvasToNormalTex(hgt.canvas, 3.4, { key: `${key}_n`, repeatX: 2.0, repeatY: 1.5 }),
  };
  _cache.set(key, maps);
  return maps;
}

export function getBambooCulmTexture(isDay = false) {
  const key = `bamboo_culm_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const { canvas, ctx } = makeCanvas(64, 256);
  const grad = ctx.createLinearGradient(0, 0, 64, 0);
  if (isDay) {
    grad.addColorStop(0, "#496828");
    grad.addColorStop(0.45, "#85aa4d");
    grad.addColorStop(1, "#3d5620");
  } else {
    grad.addColorStop(0, "#192918");
    grad.addColorStop(0.45, "#2f482a");
    grad.addColorStop(1, "#142012");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);

  for (let y = 32; y < 256; y += 44) {
    ctx.fillStyle = isDay ? "#bfd086" : "#546c46";
    ctx.fillRect(0, y, 64, 3);
    ctx.fillStyle = "rgba(10, 14, 10, 0.45)";
    ctx.fillRect(0, y + 3, 64, 2);
  }

  return makeTex(canvas, { key, srgb: true, repeatX: 1, repeatY: 3 });
}

export function getBarkMaps(isDay = false) {
  const key = `bark_hi_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const S = 256;
  const col = makeCanvas(S, S);
  const hgt = makeCanvas(S, S);
  const cctx = col.ctx;
  const hctx = hgt.ctx;

  cctx.fillStyle = isDay ? "#5a4530" : "#221d18";
  cctx.fillRect(0, 0, S, S);
  hctx.fillStyle = "#707070";
  hctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 420; i++) {
    const x = seededNoise(i, 1, 5) * S;
    const y = seededNoise(i, 2, 9) * S;
    const h = 18 + seededNoise(i, 3, 13) * 42;
    const d = seededNoise(i, 4, 17);
    const r = isDay ? 56 + d * 54 : 20 + d * 26;
    const g = isDay ? 44 + d * 42 : 18 + d * 22;
    const b = isDay ? 30 + d * 28 : 14 + d * 16;
    cctx.strokeStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    cctx.lineWidth = 2.4;
    cctx.beginPath();
    cctx.moveTo(x, y);
    cctx.lineTo(x + (d - 0.5) * 6, y + h);
    cctx.stroke();

    const bv = (50 + d * 185) | 0;
    hctx.strokeStyle = `rgb(${bv},${bv},${bv})`;
    hctx.lineWidth = 2.4;
    hctx.beginPath();
    hctx.moveTo(x, y);
    hctx.lineTo(x + (d - 0.5) * 6, y + h);
    hctx.stroke();
  }

  const maps = {
    map: makeTex(col.canvas, { key: `${key}_c`, srgb: true, repeatX: 1, repeatY: 4 }),
    normalMap: heightCanvasToNormalTex(hgt.canvas, 2.5, { key: `${key}_n`, repeatX: 1, repeatY: 4 }),
  };
  _cache.set(key, maps);
  return maps;
}

/** 512x512 crisp alpha-tested broadleaf botanical canopy rosette (used on 3D curved domes) */
export function getBroadleafClusterTexture(isDay = false, tintVariant = 0) {
  const key = `broadleaf_hi_${isDay ? "d" : "n"}_${tintVariant}`;
  if (_cache.has(key)) return _cache.get(key);

  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  const palettesDay = [
    ["#234b1f", "#3a6e2b", "#5c9239", "#8bb84b"],
    ["#2a5221", "#44782e", "#6da13f", "#9dc454"],
    ["#345420", "#52742b", "#7c9b39", "#acc04e"],
  ];
  const palettesNight = [
    ["#101d14", "#182c1e", "#223c27", "#305033"],
    ["#0f1b17", "#162821", "#20382d", "#2c4a3a"],
    ["#121f14", "#1b2e1d", "#263f27", "#355333"],
  ];
  const pal = (isDay ? palettesDay : palettesNight)[tintVariant % 3];

  const leaves = 150;
  for (let i = 0; i < leaves; i++) {
    const ang = seededNoise(i, 1, 17) * Math.PI * 2;
    const rad = Math.pow(seededNoise(i, 2, 23), 0.62) * 195;
    const cx = 256 + Math.cos(ang) * rad;
    const cy = 252 + Math.sin(ang) * rad * 0.90 - 8;
    const lw = 20 + seededNoise(i, 3, 29) * 22;
    const lh = lw * (0.48 + seededNoise(i, 4, 31) * 0.22);
    const rot = ang + (seededNoise(i, 5, 37) - 0.5) * 1.1;

    const heightBias = (1 - cy / S) * 0.68 + seededNoise(i, 6, 41) * 0.32;
    const colIdx = Math.min(3, Math.floor(heightBias * 4));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(-lw, 0);
    ctx.quadraticCurveTo(0, -lh, lw, 0);
    ctx.quadraticCurveTo(0, lh, -lw, 0);
    ctx.closePath();
    ctx.fillStyle = pal[colIdx];
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = isDay ? "rgba(18,28,12,0.48)" : "rgba(6,10,8,0.62)";
    ctx.stroke();

    // Leaf center vein
    ctx.beginPath();
    ctx.moveTo(-lw * 0.8, 0);
    ctx.lineTo(lw * 0.8, 0);
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = isDay ? "rgba(185,220,120,0.22)" : "rgba(90,130,96,0.18)";
    ctx.stroke();
    ctx.restore();
  }

  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

export function getBambooSprayTexture(isDay = false) {
  const key = `bamboo_spray_hi_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const S = 384;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  const colors = isDay
    ? ["#3e6b29", "#5c8c38", "#83af4c"]
    : ["#162718", "#1f3622", "#2b492c"];

  for (let b = 0; b < 7; b++) {
    const startY = 44 + b * 44;
    const dir = b % 2 === 0 ? 1 : -1;
    ctx.strokeStyle = isDay ? "#566e32" : "#1c2c1b";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(192, startY);
    ctx.quadraticCurveTo(192 + dir * 70, startY + 26, 192 + dir * 136, startY + 66);
    ctx.stroke();

    for (let l = 0; l < 13; l++) {
      const t = (l + 1) / 13;
      const lx = 192 + dir * t * 130;
      const ly = startY + t * t * 62;
      const ang = (dir > 0 ? 0.55 : Math.PI - 0.55) + (seededNoise(b, l, 9) - 0.5) * 0.72;
      const len = 36 + seededNoise(b, l, 15) * 26;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.48, -6.0, len, 0);
      ctx.quadraticCurveTo(len * 0.48, 6.0, 0, 0);
      ctx.closePath();
      ctx.fillStyle = colors[(b + l) % colors.length];
      ctx.fill();
      ctx.restore();
    }
  }

  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

export function getBananaLeafTexture(isDay = false) {
  const key = `banana_leaf_hi_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const W = 192, H = 384;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  ctx.beginPath();
  ctx.moveTo(96, 372);
  ctx.bezierCurveTo(20, 315, 16, 108, 96, 14);
  ctx.bezierCurveTo(176, 108, 172, 315, 96, 372);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 14, W, 372);
  if (isDay) {
    grad.addColorStop(0, "#8bc24d");
    grad.addColorStop(0.5, "#609835");
    grad.addColorStop(1, "#386820");
  } else {
    grad.addColorStop(0, "#2c4f2c");
    grad.addColorStop(0.5, "#1f3b20");
    grad.addColorStop(1, "#132615");
  }
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.lineWidth = 2.6;
  ctx.strokeStyle = isDay ? "rgba(28,44,14,0.58)" : "rgba(7,12,8,0.68)";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(96, 372);
  ctx.lineTo(96, 20);
  ctx.lineWidth = 4.2;
  ctx.strokeStyle = isDay ? "#b0d56c" : "#3b5f39";
  ctx.stroke();

  ctx.lineWidth = 1.4;
  ctx.strokeStyle = isDay ? "rgba(38,62,18,0.30)" : "rgba(10,18,12,0.40)";
  for (let y = 46; y < 344; y += 14) {
    const hw = Math.sin(((y - 14) / 358) * Math.PI) * 68;
    ctx.beginPath();
    ctx.moveTo(96, y);
    ctx.lineTo(96 - hw, y - 13);
    ctx.moveTo(96, y);
    ctx.lineTo(96 + hw, y - 13);
    ctx.stroke();
  }

  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

export function getPalmFrondTexture(isDay = false) {
  const key = `palm_frond_hi2_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const W = 256, H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = isDay ? "#687834" : "#1a2817";
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(128, 502);
  ctx.lineTo(128, 12);
  ctx.stroke();

  for (let y = 22; y < 484; y += 9) {
    const env = Math.sin(((y - 12) / 478) * Math.PI);
    const span = 18 + Math.pow(env, 0.82) * 102;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(128, y);
      ctx.quadraticCurveTo(128 + dir * span * 0.58, y - 16, 128 + dir * span, y + 12);
      ctx.quadraticCurveTo(128 + dir * span * 0.52, y - 4, 128, y + 4);
      ctx.closePath();
      const alt = ((y / 9) | 0) % 2 === 0;
      ctx.fillStyle = isDay
        ? (alt ? "#4e802c" : "#38631f")
        : (alt ? "#1e351e" : "#132415");
      ctx.fill();
    }
  }

  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

export function getWarmWindowTexture() {
  const key = "warm_window_hi";
  if (_cache.has(key)) return _cache.get(key);

  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 70);
  g.addColorStop(0, "#fff5ca");
  g.addColorStop(0.42, "#ffb956");
  g.addColorStop(1, "#c45614");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = "rgba(38, 22, 12, 0.76)";
  ctx.fillRect(60, 0, 8, 128);
  ctx.fillRect(0, 60, 128, 8);
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(34, 20, 10, 0.88)";
  ctx.strokeRect(4, 4, 120, 120);

  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

export function getMistWispTexture() {
  const key = "mist_wisp_hi";
  if (_cache.has(key)) return _cache.get(key);

  const { canvas, ctx } = makeCanvas(256, 128);
  const blobs = [
    [128, 64, 112, 46, 0.36],
    [82, 68, 74, 34, 0.28],
    [174, 66, 72, 34, 0.28],
    [128, 48, 62, 26, 0.22],
  ];
  for (const [cx, cy, rx, ry, a] of blobs) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
    g.addColorStop(0, `rgba(232, 240, 246, ${a})`);
    g.addColorStop(0.55, `rgba(210, 222, 232, ${a * 0.55})`);
    g.addColorStop(1, "rgba(195, 210, 222, 0.0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

export function getSoftGlowTexture() {
  const key = "soft_glow_hi";
  if (_cache.has(key)) return _cache.get(key);
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, "rgba(255, 244, 204, 1.0)");
  g.addColorStop(0.30, "rgba(255, 186, 86, 0.56)");
  g.addColorStop(0.68, "rgba(245, 130, 48, 0.14)");
  g.addColorStop(1, "rgba(245, 120, 40, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

/** High-resolution tactile soil/grass/pebble ground micro-detail albedo + normal maps */
export function getGroundDetailMaps(isDay = false) {
  const key = `ground_detail_hi_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const S = 512;
  const col = makeCanvas(S, S);
  const hgt = makeCanvas(S, S);
  const cctx = col.ctx;
  const hctx = hgt.ctx;

  cctx.fillStyle = "#d8d8d8";
  cctx.fillRect(0, 0, S, S);
  hctx.fillStyle = "#808080";
  hctx.fillRect(0, 0, S, S);

  // Subtle organic earth speckles, turf tufts & pebbles
  for (let i = 0; i < 4200; i++) {
    const x = seededNoise(i, 1, 7) * S;
    const y = seededNoise(i, 2, 13) * S;
    const r = 1.0 + seededNoise(i, 3, 19) * 3.8;
    const v = seededNoise(i, 4, 23);
    const shade = (165 + v * 90) | 0;
    cctx.fillStyle = `rgba(${shade},${shade},${shade},0.42)`;
    cctx.beginPath();
    cctx.arc(x, y, r, 0, Math.PI * 2);
    cctx.fill();

    const hv = (45 + v * 175) | 0;
    hctx.fillStyle = `rgb(${hv},${hv},${hv})`;
    hctx.beginPath();
    hctx.arc(x, y, r, 0, Math.PI * 2);
    hctx.fill();
  }

  const maps = {
    map: makeTex(col.canvas, { key: `${key}_c`, srgb: true, repeatX: 18, repeatY: 18 }),
    normalMap: heightCanvasToNormalTex(hgt.canvas, isDay ? 2.2 : 1.8, { key: `${key}_n`, repeatX: 18, repeatY: 18 }),
  };
  _cache.set(key, maps);
  return maps;
}

/** Mountain crag, ravine & dense canopy stipple normal map for crisp hill-tract mountain relief */
export function getMountainDetailNormalMap() {
  const key = "mountain_detail_normal_hi";
  if (_cache.has(key)) return _cache.get(key);

  const S = 512;
  const hgt = makeCanvas(S, S);
  const hctx = hgt.ctx;
  hctx.fillStyle = "#7a7a7a";
  hctx.fillRect(0, 0, S, S);

  // Vertical/diagonal eroded gully grooves + dense forest-canopy bumps
  for (let i = 0; i < 650; i++) {
    const x = seededNoise(i, 1, 31) * S;
    const y = seededNoise(i, 2, 37) * S;
    const len = 26 + seededNoise(i, 3, 41) * 70;
    const tilt = (seededNoise(i, 4, 43) - 0.5) * 28;
    const v = (42 + seededNoise(i, 5, 47) * 165) | 0;
    hctx.strokeStyle = `rgba(${v},${v},${v},0.48)`;
    hctx.lineWidth = 2.0 + seededNoise(i, 6, 53) * 3.2;
    hctx.beginPath();
    hctx.moveTo(x, y);
    hctx.lineTo(x + tilt, y + len);
    hctx.stroke();
  }

  for (let i = 0; i < 2400; i++) {
    const x = seededNoise(i, 7, 61) * S;
    const y = seededNoise(i, 8, 67) * S;
    const r = 2.2 + seededNoise(i, 9, 71) * 5.2;
    const v = (80 + seededNoise(i, 10, 73) * 165) | 0;
    hctx.fillStyle = `rgba(${v},${v},${v},0.55)`;
    hctx.beginPath();
    hctx.arc(x, y, r, 0, Math.PI * 2);
    hctx.fill();
  }

  const normalMap = heightCanvasToNormalTex(hgt.canvas, 3.0, {
    key,
    repeatX: 6,
    repeatY: 2.5,
  });
  _cache.set(key, normalMap);
  return normalMap;
}

/** Layered soft volumetric cloud texture (sunlit morning cumulus clouds & moonlit night veils) */
export function getCloudWispsTexture(isDay = true) {
  const key = `cloud_wisp_vol_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const W = 512, H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  if (isDay) {
    // Cool silver-blue lower cloud belly first so sunlit tops layer cleanly above
    const basePuffs = [
      [148, 162, 102, 42, 0.68],
      [256, 166, 138, 46, 0.75],
      [366, 160, 98, 40, 0.66],
    ];
    for (const [cx, cy, rx, ry, alpha] of basePuffs) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, rx * 0.15, rx * 0.08, 0, 0, rx);
      g.addColorStop(0, `rgba(176, 198, 222, ${alpha})`);
      g.addColorStop(0.62, `rgba(192, 212, 232, ${alpha * 0.58})`);
      g.addColorStop(1, "rgba(210, 224, 240, 0.0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const puffs = [
    [130, 142, 96, 52, isDay ? 0.78 : 0.50],
    [225, 114, 118, 68, isDay ? 0.88 : 0.62],
    [325, 124, 108, 58, isDay ? 0.84 : 0.58],
    [400, 148, 84, 44, isDay ? 0.72 : 0.44],
    [262, 86, 90, 56, isDay ? 0.94 : 0.68],
    [182, 100, 82, 48, isDay ? 0.86 : 0.58],
    [310, 104, 78, 46, isDay ? 0.84 : 0.48],
  ];

  for (const [cx, cy, rx, ry, alpha] of puffs) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, -rx * 0.18, rx * 0.08, 0, 0, rx);
    if (isDay) {
      g.addColorStop(0, `rgba(255, 254, 250, ${alpha})`);
      g.addColorStop(0.56, `rgba(248, 246, 240, ${alpha * 0.72})`);
      g.addColorStop(1, "rgba(232, 238, 246, 0.0)");
    } else {
      g.addColorStop(0, `rgba(184, 200, 214, ${alpha * 0.72})`);
      g.addColorStop(0.55, `rgba(128, 146, 166, ${alpha * 0.42})`);
      g.addColorStop(1, "rgba(80, 96, 115, 0.0)");
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

/** Painted hill-tract butterfly right-wing texture (mirrored for left wing) */
export function getButterflyWingTexture(paletteIdx = 0) {
  const key = `butterfly_wing_${paletteIdx}`;
  if (_cache.has(key)) return _cache.get(key);

  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  const palettes = [
    { fill: "#f28a24", inner: "#ffd35c", edge: "#1b1410", spots: "#fff6e0" }, // Monarch orange
    { fill: "#f5cb38", inner: "#fff29e", edge: "#2e2414", spots: "#ffffff" }, // Saffron yellow
    { fill: "#48a6e8", inner: "#a4e2ff", edge: "#16202e", spots: "#f0f9ff" }, // Mountain azure
    { fill: "#f6efe0", inner: "#fffdf6", edge: "#3c3228", spots: "#f2a648" }, // Cream swallowtail / moon-moth
  ];
  const pal = palettes[paletteIdx % palettes.length];

  // Upper forewing attached along left edge (x = 4)
  ctx.beginPath();
  ctx.moveTo(4, 62);
  ctx.bezierCurveTo(22, 10, 114, 6, 118, 36);
  ctx.bezierCurveTo(120, 58, 72, 68, 4, 66);
  ctx.closePath();
  const fg = ctx.createRadialGradient(34, 46, 6, 62, 36, 78);
  fg.addColorStop(0, pal.inner);
  fg.addColorStop(0.68, pal.fill);
  fg.addColorStop(1, pal.edge);
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = pal.edge;
  ctx.stroke();

  // Lower hindwing
  ctx.beginPath();
  ctx.moveTo(4, 64);
  ctx.bezierCurveTo(66, 66, 98, 84, 82, 112);
  ctx.bezierCurveTo(64, 124, 18, 104, 4, 72);
  ctx.closePath();
  const hg = ctx.createRadialGradient(26, 84, 4, 48, 90, 58);
  hg.addColorStop(0, pal.inner);
  hg.addColorStop(0.7, pal.fill);
  hg.addColorStop(1, pal.edge);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = pal.edge;
  ctx.stroke();

  // Wingtip spots & delicate veins
  ctx.fillStyle = pal.spots;
  for (const [sx, sy, r] of [[96, 28, 5], [104, 42, 4], [88, 48, 3.5], [70, 98, 4]]) {
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

/** Realistic feathered right bird wing texture with scalloped secondaries & slotted primary tips */
export function getBirdWingTexture(isDay = true) {
  const key = `bird_wing_plumage_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const W = 256, H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  // Leading-edge wing membrane + covert base (root at x=0, tip at x=252)
  ctx.beginPath();
  ctx.moveTo(0, 14);
  ctx.bezierCurveTo(68, 8, 152, 16, 246, 40);
  ctx.bezierCurveTo(212, 68, 154, 96, 98, 108);
  ctx.bezierCurveTo(56, 114, 18, 104, 0, 96);
  ctx.closePath();

  const baseGrad = ctx.createLinearGradient(0, 18, 248, 82);
  if (isDay) {
    baseGrad.addColorStop(0.0, "#faf6ec");
    baseGrad.addColorStop(0.42, "#ebe5d7");
    baseGrad.addColorStop(0.68, "#5d6870");
    baseGrad.addColorStop(1.0, "#1c242b");
  } else {
    baseGrad.addColorStop(0.0, "#3d4d5a");
    baseGrad.addColorStop(0.55, "#222d36");
    baseGrad.addColorStop(1.0, "#0f151b");
  }
  ctx.fillStyle = baseGrad;
  ctx.fill();

  // Overlapping secondary covert feathers (inner wing x=6..140)
  for (let i = 0; i < 9; i++) {
    const fx = 10 + i * 14.5;
    const fy = 56 + Math.sin(i * 0.4) * 6;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(0.08 + i * 0.02);
    ctx.beginPath();
    ctx.ellipse(0, 20, 11, 34, 0, 0, Math.PI * 2);
    ctx.fillStyle = isDay
      ? i % 2 === 0
        ? "rgba(246, 241, 230, 0.92)"
        : "rgba(226, 220, 206, 0.90)"
      : "rgba(42, 54, 64, 0.92)";
    ctx.fill();
    ctx.strokeStyle = isDay ? "rgba(120, 128, 134, 0.35)" : "rgba(18, 24, 30, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  // Slotted outer primary flight feathers fanning gracefully at wingtip (x=136..250)
  for (let p = 0; p < 6; p++) {
    const t = p / 5;
    const px = 140 + p * 18;
    const py = 46 - p * 2.5;
    const len = 62 - p * 4;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.48 - t * 0.42);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.quadraticCurveTo(len * 0.65, -7, len, 0);
    ctx.quadraticCurveTo(len * 0.65, 7, 0, 7);
    ctx.closePath();
    ctx.fillStyle = isDay ? (p < 2 ? "#3b464f" : "#1c242b") : "#121a21";
    ctx.fill();
    ctx.strokeStyle = isDay ? "rgba(225, 232, 238, 0.28)" : "rgba(110, 132, 152, 0.25)";
    ctx.lineWidth = 1.0;
    ctx.stroke();
    ctx.restore();
  }

  // Subtle sunlit leading-edge feather trim
  ctx.beginPath();
  ctx.moveTo(2, 16);
  ctx.bezierCurveTo(68, 10, 150, 18, 240, 41);
  ctx.strokeStyle = isDay ? "rgba(255, 252, 244, 0.85)" : "rgba(130, 156, 178, 0.45)";
  ctx.lineWidth = 3;
  ctx.stroke();

  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

/** Fanned feathered tail texture for articulated 3D birds */
export function getBirdTailTexture(isDay = true) {
  const key = `bird_tail_plumage_${isDay ? "d" : "n"}`;
  if (_cache.has(key)) return _cache.get(key);

  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  // Tail base at top center (64, 8), fanning downward to y=118
  for (let i = -3; i <= 3; i++) {
    ctx.save();
    ctx.translate(64, 12);
    ctx.rotate(i * 0.14);
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.quadraticCurveTo(-10, 68, 0, 102 - Math.abs(i) * 4);
    ctx.quadraticCurveTo(10, 68, 8, 0);
    ctx.closePath();
    ctx.fillStyle = isDay
      ? Math.abs(i) === 3
        ? "#2a333c"
        : i % 2 === 0
        ? "#e7e1d4"
        : "#cfc9bc"
      : "#1a232b";
    ctx.fill();
    ctx.strokeStyle = isDay ? "rgba(60,70,80,0.28)" : "rgba(8,12,16,0.45)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  return makeTex(canvas, { key, srgb: true, wrap: THREE.ClampToEdgeWrapping });
}



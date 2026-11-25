/**
 * src/scene/terrain3d.js — Calibrated High-Detail 3D Hill-Tract Terrain,
 * Physical Stepped Rice Terraces (with Moonlit Water Shelves), Raised Vegetable Beds,
 * Winding Dirt Roads & Valley Stream (Night & Day).
 */

import * as THREE from "three";
import { getGroundDetailMaps } from "./textures3d.js";

export const IMG_WIDTH = 1376;
export const IMG_HEIGHT = 768;
export const IMG_ASPECT = IMG_WIDTH / IMG_HEIGHT;

export const LOCKED_CAMERA_POS = new THREE.Vector3(0.0, 10.8, 34.0);
export const LOCKED_CAMERA_TARGET = new THREE.Vector3(0.0, 3.6, -12.0);
export const LOCKED_FOV_DEG = 34.0;

const _calCam = new THREE.PerspectiveCamera(LOCKED_FOV_DEG, IMG_ASPECT, 0.5, 420);
_calCam.position.copy(LOCKED_CAMERA_POS);
_calCam.lookAt(LOCKED_CAMERA_TARGET);
_calCam.updateMatrixWorld(true);

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function fbm2(x, z) {
  return (
    Math.sin(x * 0.13 + z * 0.09) * 0.44 +
    Math.cos(x * 0.25 - z * 0.19) * 0.27 +
    Math.sin(x * 0.49 + z * 0.44) * 0.14
  );
}

function distToPolyline(x, z, pts) {
  let minD = Infinity;
  let nearestT = 0;
  let totalLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const bx = pts[i + 1][0];
    const bz = pts[i + 1][1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-6;
    const segLen = Math.sqrt(l2);
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / l2);
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < minD) {
      minD = d;
      nearestT = totalLen + t * segLen;
    }
    totalLen += segLen;
  }
  return { dist: minD, s: totalLen > 0 ? nearestT / totalLen : 0 };
}

/**
 * Calibrated continuous 3D terrain heightfield y(x, z) spanning z in [-92, +16].
 * Eliminates any horizon cutoff seam and forms true deep valleys and sculpted village hills.
 */
export function terrainHeightAt(x, z, mode = "dark") {
  if (mode === "light") {
    // Day hill-tract topography:
    // - Deep forested valley dropping away on left-center (x < -3)
    // - Rising sunlit hillside sweeping across center & right into background
    const backSlope = smoothstep(14, -54, z) * 7.6;
    const rightHill = smoothstep(-7, 26, x) * 5.8;
    const leftValleyDrop = smoothstep(0, -18, x) * smoothstep(-50, 8, z) * 3.1;
    const fgLeftBank = smoothstep(2, 14, z) * (1 - smoothstep(-19, -4, x)) * 1.65;
    const farTailDrop = smoothstep(-58, -92, z) * 2.8;
    const undulation = fbm2(x * 0.78, z * 0.78) * 0.48;

    let h = -0.9 + backSlope + rightHill - leftValleyDrop + fgLeftBank - farTailDrop + undulation;

    // Gentle flattening for foreground right hearth courtyard (near u=0.84, v=0.90)
    const court = Math.exp(-((x - 7.4) ** 2 / 28 + (z - 7.8) ** 2 / 14));
    h = THREE.MathUtils.lerp(h, 0.55, court * 0.58);

    return h;
  }

  // Night topography:
  // - Steep foreground-left Machang bluff (x < -4, z > -6)
  // - Deep misty central-left river gorge (x ~ -14..-1, extending back to -80)
  // - Sculpted center-right hillside carrying rice terraces, S-curve trail & stilt huts
  const backSlope = smoothstep(12, -52, z) * 5.6;
  const rightHill = smoothstep(0.0, 26, x) * 6.4;
  const leftBluff = (1 - smoothstep(-18, -4.2, x)) * smoothstep(-10, 12, z) * 3.4;
  const valleyGorge =
    Math.exp(-((x + 6.2) ** 2 / 58)) * smoothstep(13, -38, z) * 3.1;
  const farValleyDip = smoothstep(-48, -92, z) * (1 - smoothstep(4, 24, x)) * 2.4;

  let h = -0.65 + backSlope + rightHill + leftBluff - valleyGorge - farValleyDip + fbm2(x, z) * 0.42;

  // Stepped terrace shelf modulation on center-right hillside (x in -4.5..6.0, z in -18..6)
  const terraceMask =
    smoothstep(-6.0, -2.5, x) *
    (1 - smoothstep(4.2, 7.8, x)) *
    smoothstep(-20, -10, z) *
    (1 - smoothstep(4, 10, z));
  if (terraceMask > 0.01) {
    const stepSize = 0.64;
    const phase = ((h % stepSize) + stepSize) % stepSize / stepSize;
    const stepped = Math.floor(h / stepSize) * stepSize + smoothstep(0.18, 0.82, phase) * stepSize * 0.25;
    h = THREE.MathUtils.lerp(h, stepped, terraceMask * 0.76);
  }

  return h;
}

/** Ray-cast from locked static camera through normalized image (u, v) to 3D terrain */
export function solveTerrainAtUV(u, v, mode = "dark", yOffset = 0) {
  const ndc = new THREE.Vector3(u * 2 - 1, 1 - v * 2, 0.5).unproject(_calCam);
  const origin = _calCam.position;
  const dir = ndc.sub(origin).normalize();

  let lo = 6.0;
  let hi = 148.0;
  let prevT = lo;
  let found = false;

  for (let t = lo; t <= hi; t += 0.9) {
    const rx = origin.x + dir.x * t;
    const ry = origin.y + dir.y * t;
    const rz = origin.z + dir.z * t;
    if (ry <= terrainHeightAt(rx, rz, mode)) {
      lo = prevT;
      hi = t;
      found = true;
      break;
    }
    prevT = t;
  }

  if (!found) {
    const tFallback = (0 - origin.y) / Math.min(-0.02, dir.y);
    const fx = origin.x + dir.x * tFallback;
    const fz = origin.z + dir.z * tFallback;
    return new THREE.Vector3(fx, terrainHeightAt(fx, fz, mode) + yOffset, fz);
  }

  for (let iter = 0; iter < 12; iter++) {
    const mid = (lo + hi) * 0.5;
    const rx = origin.x + dir.x * mid;
    const ry = origin.y + dir.y * mid;
    const rz = origin.z + dir.z * mid;
    if (ry <= terrainHeightAt(rx, rz, mode)) hi = mid;
    else lo = mid;
  }

  const tFinal = (lo + hi) * 0.5;
  const x = origin.x + dir.x * tFinal;
  const z = origin.z + dir.z * tFinal;
  return new THREE.Vector3(x, terrainHeightAt(x, z, mode) + yOffset, z);
}

function buildPolylineXZ(uvPoints, mode) {
  return uvPoints.map(([u, v]) => {
    const p = solveTerrainAtUV(u, v, mode, 0);
    return [p.x, p.z];
  });
}

// Reference-calibrated UV curves converted into world XZ paths
export const NIGHT_ROAD_UVS = [
  [0.695, 0.99],
  [0.735, 0.905],
  [0.772, 0.835],
  [0.793, 0.778],
  [0.770, 0.715],
  [0.732, 0.672],
  [0.684, 0.650],
  [0.656, 0.618],
  [0.688, 0.588],
  [0.720, 0.566],
  [0.704, 0.540],
  [0.668, 0.518],
  [0.632, 0.504],
];

export const NIGHT_VALLEY_ROAD_UVS = [
  [0.656, 0.618],
  [0.576, 0.642],
  [0.506, 0.688],
  [0.448, 0.742],
  [0.422, 0.788],
  [0.478, 0.808],
  [0.446, 0.848],
  [0.424, 0.905],
];

export const NIGHT_MACHANG_TRAIL_UVS = [
  [0.168, 0.785],
  [0.192, 0.828],
  [0.214, 0.870],
  [0.200, 0.935],
];

export const NIGHT_STREAM_UVS = [
  [0.442, 0.515],
  [0.424, 0.555],
  [0.402, 0.592],
  [0.362, 0.628],
  [0.338, 0.672],
  [0.376, 0.712],
  [0.378, 0.758],
  [0.352, 0.805],
];

export const DAY_ROAD_UVS = [
  [0.755, 0.99],
  [0.785, 0.925],
  [0.775, 0.865],
  [0.750, 0.806],
  [0.732, 0.748],
  [0.708, 0.702],
  [0.672, 0.672],
  [0.638, 0.638],
  [0.632, 0.594],
  [0.676, 0.556],
  [0.748, 0.542],
  [0.815, 0.506],
];

export const DAY_LEFT_TRAIL_UVS = [
  [0.508, 0.692],
  [0.464, 0.748],
  [0.432, 0.795],
  [0.372, 0.862],
  [0.335, 0.905],
];

export const DAY_STREAM_UVS = [
  [0.355, 0.480],
  [0.350, 0.540],
  [0.335, 0.610],
  [0.312, 0.690],
  [0.280, 0.780],
  [0.245, 0.870],
];

/** Builds sculpted 3D curved rice-paddy terraces with raised earthen bunds & moonlit water shelves */
function buildNightRiceTerraces(group, disposables) {
  const bundMat = new THREE.MeshStandardMaterial({
    color: 0x263b22,
    roughness: 0.92,
    metalness: 0.0,
  });
  const paddyWaterMat = new THREE.MeshStandardMaterial({
    color: 0x3b5848,
    roughness: 0.14,
    metalness: 0.22,
  });
  disposables.push(bundMat, paddyWaterMat);

  // 6 stepped crescent paddy shelves sweeping across center-right slope (u: 0.44..0.60, v: 0.58..0.77)
  const terraceDefs = [
    { vMid: 0.598, uLeft: 0.500, uRight: 0.585 },
    { vMid: 0.625, uLeft: 0.482, uRight: 0.580 },
    { vMid: 0.654, uLeft: 0.465, uRight: 0.575 },
    { vMid: 0.684, uLeft: 0.452, uRight: 0.568 },
    { vMid: 0.715, uLeft: 0.445, uRight: 0.556 },
    { vMid: 0.746, uLeft: 0.448, uRight: 0.538 },
  ];

  for (const td of terraceDefs) {
    const pts = [];
    const steps = 10;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = THREE.MathUtils.lerp(td.uLeft, td.uRight, t);
      const bow = Math.sin(t * Math.PI) * 0.018;
      const p = solveTerrainAtUV(u, td.vMid + bow, "dark", 0.04);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);

    // Earthen terrace bund wall lip
    const bundGeo = new THREE.TubeGeometry(curve, 24, 0.16, 6, false);
    bundGeo.scale(1, 0.78, 1);
    const bund = new THREE.Mesh(bundGeo, bundMat);
    bund.castShadow = true;
    bund.receiveShadow = true;
    group.add(bund);
    disposables.push(bundGeo);

    // Flooded moonlit paddy water shelf nestled just behind the bund
    const shelfPts = pts.map((p) => p.clone().add(new THREE.Vector3(0, 0.02, -0.55)));
    const shapePts = [];
    for (const p of pts) shapePts.push(new THREE.Vector2(p.x, p.z));
    for (let k = shelfPts.length - 1; k >= 0; k--) {
      shapePts.push(new THREE.Vector2(shelfPts[k].x, shelfPts[k].z));
    }
    const avgY = pts.reduce((acc, p) => acc + p.y, 0) / pts.length - 0.02;
    const shelfShape = new THREE.Shape(shapePts);
    const shelfGeo = new THREE.ShapeGeometry(shelfShape);
    shelfGeo.rotateX(Math.PI * 0.5);
    const shelf = new THREE.Mesh(shelfGeo, paddyWaterMat);
    shelf.position.y = avgY;
    shelf.receiveShadow = true;
    group.add(shelf);
    disposables.push(shelfGeo);
  }
}

/** Builds physical 3D raised vegetable garden beds with InstancedMesh leafy crop rosettes (Day) */
function buildDayVegetableBeds(group, disposables) {
  const soilMaps = getGroundDetailMaps(true);
  const bedMat = new THREE.MeshStandardMaterial({
    color: 0x5c462b,
    map: soilMaps.map,
    normalMap: soilMaps.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.94,
  });

  // Leafy rosette blade geometry for crisp instanced vegetable crops
  const cropGeo = new THREE.PlaneGeometry(0.32, 0.24, 2, 2);
  cropGeo.rotateX(-Math.PI * 0.28);
  const cp = cropGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i);
    const z = cp.getZ(i);
    cp.setY(i, cp.getY(i) + 0.08 - (x * x + z * z) * 1.4);
  }
  cropGeo.computeVertexNormals();

  const cropMat = new THREE.MeshStandardMaterial({
    color: 0x6ba638,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  disposables.push(bedMat, cropGeo, cropMat);

  const bedSpecs = [
    [0.745, 0.590, 0.805, 0.614],
    [0.740, 0.608, 0.802, 0.634],
    [0.736, 0.628, 0.798, 0.654],
    [0.792, 0.608, 0.848, 0.634],
    [0.788, 0.628, 0.844, 0.654],
    [0.784, 0.648, 0.840, 0.674],
  ];

  const cropTransforms = [];
  const dummy = new THREE.Object3D();

  for (let b = 0; b < bedSpecs.length; b++) {
    const [u0, v0, u1, v1] = bedSpecs[b];
    const p0 = solveTerrainAtUV(u0, v0, "light", 0.04);
    const p1 = solveTerrainAtUV(u1, v1, "light", 0.04);
    const len = p0.distanceTo(p1);
    const bedGeo = new THREE.BoxGeometry(0.46, 0.18, len);
    const bed = new THREE.Mesh(bedGeo, bedMat);
    bed.position.copy(p0).lerp(p1, 0.5);
    bed.lookAt(p1);
    bed.castShadow = true;
    bed.receiveShadow = true;
    group.add(bed);
    disposables.push(bedGeo);

    const plants = 7;
    for (let k = 0; k < plants; k++) {
      const t = (k + 0.5) / plants;
      const wp = p0.clone().lerp(p1, t);
      for (let r = 0; r < 3; r++) {
        dummy.position.set(wp.x + (r - 1) * 0.05, wp.y + 0.09, wp.z);
        dummy.rotation.set(0.18, r * 2.09 + b * 0.7 + k * 0.4, 0);
        const sc = 0.85 + ((k + b) % 3) * 0.16;
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        cropTransforms.push(dummy.matrix.clone());
      }
    }
  }

  const inst = new THREE.InstancedMesh(cropGeo, cropMat, cropTransforms.length);
  cropTransforms.forEach((m, idx) => inst.setMatrixAt(idx, m));
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);
}

/** Injects subtle world-space procedural soil/grass/pebble micro-detail into terrain PBR shader */
function applyTerrainMicroDetailShader(mat, isDay) {
  mat.customProgramCacheKey = () => `pahari_terrain_micro_${isDay ? "d" : "n"}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vTerrainWorldPos;`
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vTerrainWorldPos;
        float tHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float tNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x),
            mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float micro = tNoise(vTerrainWorldPos.xz * 2.4) * 0.65 + tNoise(vTerrainWorldPos.xz * 7.5) * 0.35;
        float blades = tNoise(vec2(vTerrainWorldPos.x * 16.0, vTerrainWorldPos.z * 16.0));
        diffuseColor.rgb *= mix(0.84, 1.16, micro);
        diffuseColor.rgb *= mix(0.92, 1.08, blades);`
      );
  };
}

export function createTerrainForMode(mode = "dark", opts = {}) {
  const isDay = mode === "light";
  const isMobile = Boolean(opts.isMobile);
  const group = new THREE.Group();
  const disposables = [];

  const mainXZ = buildPolylineXZ(isDay ? DAY_ROAD_UVS : NIGHT_ROAD_UVS, mode);
  const spurXZ = buildPolylineXZ(isDay ? DAY_LEFT_TRAIL_UVS : NIGHT_VALLEY_ROAD_UVS, mode);
  const machangXZ = isDay ? null : buildPolylineXZ(NIGHT_MACHANG_TRAIL_UVS, mode);
  const streamXZ = buildPolylineXZ(isDay ? DAY_STREAM_UVS : NIGHT_STREAM_UVS, mode);

  // Dense terrain mesh spanning [-48..48] x [-92..16] — seamless horizon join!
  const segX = isMobile ? 140 : 180;
  const segZ = isMobile ? 112 : 144;
  const width = 96;
  const depth = 108;
  const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
  geo.rotateX(-Math.PI * 0.5);
  geo.translate(0, 0, -38);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cTmp = new THREE.Color();
  const cGrass = new THREE.Color(isDay ? 0x5c8630 : 0x192d1c);
  const cLush = new THREE.Color(isDay ? 0x82aa3f : 0x284327);
  const cSunlitOlive = new THREE.Color(0x9bbb4e);
  const cPaddy = new THREE.Color(isDay ? 0x6e9836 : 0x385838);
  const cRoad = new THREE.Color(isDay ? 0xd9b36f : 0x856f4f);
  const cRoadRut = new THREE.Color(isDay ? 0xb58e52 : 0x625038);
  const cEarth = new THREE.Color(isDay ? 0x997742 : 0x3b3020);
  const cStreamBed = new THREE.Color(isDay ? 0x335449 : 0x1b2d34);

  const gardenCenter = isDay ? solveTerrainAtUV(0.79, 0.625, "light", 0) : null;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let y = terrainHeightAt(x, z, mode);

    const dMain = distToPolyline(x, z, mainXZ);
    const dSpur = distToPolyline(x, z, spurXZ);
    const dMach = machangXZ ? distToPolyline(x, z, machangXZ) : { dist: 99, s: 0 };
    const roadHalfW = isDay ? (1.18 - dMain.s * 0.54) : (0.96 - dMain.s * 0.42);
    const spurHalfW = isDay ? 0.55 : (0.68 - dSpur.s * 0.16);

    const fMain = 1 - smoothstep(roadHalfW * 0.45, roadHalfW * 1.15, dMain.dist);
    const fSpur = 1 - smoothstep(spurHalfW * 0.42, spurHalfW * 1.12, dSpur.dist);
    const fMach = 1 - smoothstep(0.32, 0.80, dMach.dist);
    const roadMask = Math.max(fMain, fSpur, fMach);

    // Subtle cart-track rut & hollowed trail crown
    const rut = Math.exp(-((Math.abs(dMain.dist - roadHalfW * 0.34)) ** 2 / 0.04)) * fMain;
    y -= roadMask * 0.13 + rut * 0.045;

    let streamMask = 0;
    if (streamXZ) {
      const dStr = distToPolyline(x, z, streamXZ);
      streamMask = 1 - smoothstep(isDay ? 0.48 : 0.35, isDay ? 1.15 : 0.95, dStr.dist);
      y -= streamMask * (isDay ? 0.32 : 0.36);
    }

    // Gentle soil flattening under Day vegetable beds
    if (isDay && gardenCenter) {
      const gx = x - gardenCenter.x;
      const gz = z - gardenCenter.z;
      if (Math.abs(gx) < 3.5 && Math.abs(gz) < 2.2) {
        const edge = (1 - smoothstep(2.4, 3.5, Math.abs(gx))) * (1 - smoothstep(1.3, 2.2, Math.abs(gz)));
        cTmp.set(cEarth);
        y -= edge * 0.04;
      }
    }

    pos.setY(i, y);

    const patch = smoothstep(-0.35, 0.45, fbm2(x * 1.55, z * 1.55));
    cTmp.copy(cGrass).lerp(cLush, patch);
    if (isDay) {
      const sunPatch = smoothstep(0.1, 0.7, fbm2(x * 0.6 + 2.1, z * 0.6));
      cTmp.lerp(cSunlitOlive, sunPatch * 0.42);
    }

    if (!isDay && x > -5.5 && x < 7.2 && z > -16 && z < 7) {
      cTmp.lerp(cPaddy, 0.56);
    }
    if (isDay && gardenCenter && Math.abs(x - gardenCenter.x) < 3.3 && Math.abs(z - gardenCenter.z) < 2.0) {
      cTmp.lerp(cEarth, 0.72);
    }

    // Dirt road + dusty shoulder + wheel ruts
    const shoulder = 1 - smoothstep(roadHalfW * 0.85, roadHalfW * 1.95, Math.min(dMain.dist, dSpur.dist));
    cTmp.lerp(cEarth, shoulder * 0.52);
    cTmp.lerp(cRoad, roadMask * 0.94);
    cTmp.lerp(cRoadRut, rut * 0.55);

    if (streamMask > 0.05) {
      cTmp.lerp(cStreamBed, streamMask * 0.88);
    }

    // Smooth atmospheric distance blend into mountain base haze
    const farTint = smoothstep(-24, -84, z);
    cTmp.lerp(isDay ? new THREE.Color(0x93ac6e) : new THREE.Color(0x273b42), farTint * 0.65);

    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const detailMaps = getGroundDetailMaps(isDay);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detailMaps.map,
    normalMap: detailMaps.normalMap,
    normalScale: new THREE.Vector2(isDay ? 0.95 : 0.78, isDay ? 0.95 : 0.78),
    roughness: 0.91,
    metalness: 0.02,
  });
  applyTerrainMicroDetailShader(mat, isDay);

  const terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);
  disposables.push(geo, mat);

  // Physical 3D features per mode
  if (!isDay) {
    buildNightRiceTerraces(group, disposables);
  } else {
    buildDayVegetableBeds(group, disposables);
  }

  // Animated valley stream ribbon (Day sunlit turquoise waterfall creek & Night moonlit stream)
  let waterUniforms = null;
  if (streamXZ) {
    const streamUVs = isDay ? DAY_STREAM_UVS : NIGHT_STREAM_UVS;
    const curvePts = streamUVs.map(([u, v]) => solveTerrainAtUV(u, v, mode, isDay ? -0.10 : -0.09));
    const curve = new THREE.CatmullRomCurve3(curvePts);
    const tubeGeo = new THREE.TubeGeometry(curve, 64, isDay ? 0.58 : 0.44, 8, false);
    tubeGeo.scale(1, 0.15, 1);

    const waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIsDay: { value: isDay ? 1.0 : 0.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIsDay;
        varying vec2 vUv;
        void main() {
          float flow = vUv.x * 58.0 - uTime * (uIsDay > 0.5 ? 4.2 : 2.5);
          float ripple = sin(flow + sin(vUv.y * 12.0) * 1.4) * 0.5 + 0.5;
          float ripple2 = sin(flow * 1.9 + 2.1) * 0.5 + 0.5;
          float centerMask = smoothstep(0.0, 0.45, sin(vUv.y * 3.14159));
          float sheen = pow(ripple * 0.65 + ripple2 * 0.35, 2.4) * centerMask;
          float foamEdge = smoothstep(0.68, 0.92, ripple * 0.55 + ripple2 * 0.45) * (1.0 - centerMask * 0.45);
          vec3 baseWater = uIsDay > 0.5 ? vec3(0.16, 0.46, 0.50) : vec3(0.20, 0.30, 0.35);
          vec3 specCol = uIsDay > 0.5 ? vec3(0.84, 0.96, 0.98) : vec3(0.70, 0.82, 0.88);
          vec3 col = mix(baseWater, specCol, clamp(sheen * 0.72 + foamEdge * 0.55 * uIsDay, 0.0, 1.0));
          gl_FragColor = vec4(col, uIsDay > 0.5 ? 0.92 : 0.90);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const streamMesh = new THREE.Mesh(tubeGeo, waterMat);
    group.add(streamMesh);
    disposables.push(tubeGeo, waterMat);
    waterUniforms = waterMat.uniforms;

    // Smooth mossy river boulders framing the Day waterfall creek banks
    if (isDay) {
      const rockGeo = new THREE.DodecahedronGeometry(0.42, 1);
      const rp = rockGeo.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        rp.setY(i, rp.getY(i) * 0.62);
      }
      rockGeo.computeVertexNormals();
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x5c6760,
        roughness: 0.86,
      });
      const dummy = new THREE.Object3D();
      const rockMats = [];
      for (let s = 0; s < 16; s++) {
        const t = (s + 0.5) / 16;
        const pt = curve.getPointAt(t);
        const side = s % 2 === 0 ? -1 : 1;
        const offX = side * (0.62 + (s % 3) * 0.16);
        const rx = pt.x + offX;
        const rz = pt.z + (s % 3 - 1) * 0.25;
        dummy.position.set(rx, terrainHeightAt(rx, rz, "light") + 0.05, rz);
        dummy.rotation.set((s % 4) * 0.2, s * 1.3, (s % 3) * 0.15);
        const sc = 0.65 + (s % 4) * 0.26;
        dummy.scale.set(sc * 1.25, sc * 0.78, sc);
        dummy.updateMatrix();
        rockMats.push(dummy.matrix.clone());
      }
      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockMats.length);
      rockMats.forEach((m, idx) => rocks.setMatrixAt(idx, m));
      rocks.receiveShadow = true;
      rocks.castShadow = true;
      rocks.instanceMatrix.needsUpdate = true;
      group.add(rocks);
      disposables.push(rockGeo, rockMat);
    }
  }

  return {
    group,
    update(timeSec) {
      if (waterUniforms) waterUniforms.uTime.value = timeSec;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

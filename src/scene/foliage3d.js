/**
 * src/scene/foliage3d.js — Dense Volumetric 3D Hill-Tract Forest & Village Foliage:
 * Sculpted Cupped Botanical Canopy Domes, Tapered Gnarled Bark Trunks, Arching Bamboo Groves,
 * V-Creased 3D Banana Paddle Plants, Pinnate Coconut Palms & 380+ Instanced Hillside Crowns/Shrubs.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  solveTerrainAtUV,
  terrainHeightAt,
  NIGHT_ROAD_UVS,
  NIGHT_VALLEY_ROAD_UVS,
  NIGHT_STREAM_UVS,
  DAY_ROAD_UVS,
  DAY_LEFT_TRAIL_UVS,
  DAY_STREAM_UVS,
} from "./terrain3d.js";
import {
  getBarkMaps,
  getBambooCulmTexture,
  getBroadleafClusterTexture,
  getBambooSprayTexture,
  getBananaLeafTexture,
  getPalmFrondTexture,
  getButterflyWingTexture,
} from "./textures3d.js";

function seeded(i, salt = 1) {
  const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Creates a tapered organic curved TubeGeometry along a 3D spline */
function createTaperedSplineTube(points, tubularSegs, radiusBase, radiusTip, radialSegs = 7) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, tubularSegs, radiusBase, radialSegs, false);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let i = 0; i <= tubularSegs; i++) {
    const t = i / tubularSegs;
    curve.getPointAt(t, c);
    const rootFlare = t < 0.14 ? 1.0 + (0.14 - t) * 2.3 : 1.0;
    const scale = THREE.MathUtils.lerp(1.0, radiusTip / Math.max(1e-4, radiusBase), t) * rootFlare;
    for (let j = 0; j <= radialSegs; j++) {
      const idx = i * (radialSegs + 1) + j;
      v.fromBufferAttribute(pos, idx);
      v.sub(c).multiplyScalar(scale).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** Convex 3D cupped umbrella botanical canopy dome with ruffled perimeter lobes */
function buildCuppedCanopyGeometry(radius = 1.0, domeHeight = 0.52) {
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, 8, 8);
  geo.rotateX(-Math.PI * 0.5);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const rNorm = Math.min(1.25, Math.hypot(x, z) / radius);
    const ang = Math.atan2(z, x);
    const lobe = Math.sin(ang * 5.0) * 0.09 + Math.cos(ang * 3.0) * 0.06;
    const y = (1.0 - rNorm * rNorm * 0.86) * domeHeight + lobe * rNorm * domeHeight;
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  return geo;
}

function attachWindSwayShader(mat, amplitude = 0.09, speed = 1.65, seed = 0, isCanopyDome = false) {
  mat.userData.uTime = { value: 0 };
  mat.customProgramCacheKey = () => `pahari_wind_${amplitude}_${speed}_${seed}_${isCanopyDome ? 1 : 0}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = mat.userData.uTime;
    shader.vertexShader =
      `uniform float uWindTime;\n` +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec4 wOrigin = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wOrigin = instanceMatrix * wOrigin;
        #endif
        vec3 wPos = (modelMatrix * wOrigin).xyz;
        float wMask = ${
          isCanopyDome
            ? "smoothstep(0.14, 0.96, length(position.xz))"
            : "smoothstep(0.05, 0.95, uv.y)"
        };
        float gust = sin(uWindTime * ${speed.toFixed(2)} + wPos.x * 0.34 + wPos.z * 0.26 + ${seed.toFixed(2)});
        float flutter = cos(uWindTime * ${(speed * 2.15).toFixed(2)} + wPos.x * 1.4 + wPos.y * 1.7 + ${seed.toFixed(2)}) * 0.35;
        transformed.x += (gust + flutter) * ${amplitude.toFixed(3)} * wMask;
        transformed.y += sin(uWindTime * ${(speed * 1.4).toFixed(2)} + wPos.z * 0.8 + ${seed.toFixed(2)}) * ${(amplitude * 0.48).toFixed(3)} * wMask;
        transformed.z += (cos(uWindTime * ${(speed * 0.85).toFixed(2)} + wPos.x * 0.3 + wPos.z * 0.35 + ${seed.toFixed(2)}) + flutter) * ${(amplitude * 0.65).toFixed(3)} * wMask;`
      );
  };
  return mat;
}

function mergeStaticGeos(geos) {
  if (!geos.length) return null;
  const normalized = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(normalized, false);
  for (const ng of normalized) {
    if (!geos.includes(ng)) ng.dispose();
  }
  for (const g of geos) g.dispose();
  return merged;
}

/** Multi-branch organic jungle broadleaf tree batched into shared bark geometry & instanced canopy domes */
function buildOrganicBroadleafTree({ pos, height = 5.4, spread = 2.6, seed = 0, collector }) {
  const leanX = Math.sin(seed * 2.3) * 0.55;
  const leanZ = Math.cos(seed * 1.7) * 0.42;

  const trunkPts = [
    new THREE.Vector3(0, -0.5, 0),
    new THREE.Vector3(leanX * 0.35, height * 0.25, leanZ * 0.3),
    new THREE.Vector3(leanX * 0.72, height * 0.52, leanZ * 0.65),
    new THREE.Vector3(leanX, height * 0.78, leanZ),
  ];
  const trunkGeo = createTaperedSplineTube(trunkPts, 10, height * 0.056, height * 0.020, 6);
  trunkGeo.translate(pos.x, pos.y, pos.z);
  collector.barkGeos.push(trunkGeo);

  const dummy = new THREE.Object3D();
  const branchCount = 5;
  for (let b = 0; b < branchCount; b++) {
    const ang = (b / branchCount) * Math.PI * 2 + seed * 0.9;
    const bx = leanX + Math.cos(ang) * spread * 0.58;
    const by = height * (0.72 + (b % 3) * 0.10);
    const bz = leanZ + Math.sin(ang) * spread * 0.58;

    const bPts = [
      new THREE.Vector3(leanX * 0.7, height * 0.52, leanZ * 0.6),
      new THREE.Vector3(
        THREE.MathUtils.lerp(leanX * 0.7, bx, 0.55),
        height * 0.66,
        THREE.MathUtils.lerp(leanZ * 0.6, bz, 0.55)
      ),
      new THREE.Vector3(bx, by, bz),
    ];
    const bGeo = createTaperedSplineTube(bPts, 6, height * 0.022, height * 0.008, 5);
    bGeo.translate(pos.x, pos.y, pos.z);
    collector.barkGeos.push(bGeo);

    for (let k = 0; k < 2; k++) {
      const sc = spread * (0.64 - k * 0.12);
      dummy.position.set(
        pos.x + bx + Math.cos(ang + k * 1.4) * spread * 0.10,
        pos.y + by - 0.12 + k * 0.24,
        pos.z + bz + Math.sin(ang + k * 1.4) * spread * 0.10
      );
      dummy.rotation.set(Math.sin(ang) * 0.34, ang + k * 1.1, -Math.cos(ang) * 0.34);
      dummy.scale.set(sc, sc * 0.95, sc);
      dummy.updateMatrix();
      collector.leafBuckets[(b + k) % 3].push(dummy.matrix.clone());
    }
  }

  for (let c = 0; c < 3; c++) {
    const sc = spread * (0.72 - c * 0.14);
    dummy.position.set(pos.x + leanX, pos.y + height * (0.85 + c * 0.07), pos.z + leanZ);
    dummy.rotation.set(0.18 * (c - 1), c * 1.2 + seed, 0.14 * (1 - c));
    dummy.scale.set(sc, sc * 1.08, sc);
    dummy.updateMatrix();
    collector.leafBuckets[c % 3].push(dummy.matrix.clone());
  }
}

/** Arching bamboo culm cluster batched into shared culms & instanced feathered sprays */
function buildBambooClump({ pos, height = 6.8, culms = 9, seed = 0, collector }) {
  const dummy = new THREE.Object3D();
  for (let i = 0; i < culms; i++) {
    const ang = (i / culms) * Math.PI * 2 + seed * 0.7;
    const rad = 0.22 + (i % 3) * 0.18;
    const sx = Math.cos(ang) * rad;
    const sz = Math.sin(ang) * rad;
    const h = height * (0.78 + ((i * 7) % 5) * 0.08);
    const bend = 1.05 + (i % 3) * 0.58;

    const pts = [
      new THREE.Vector3(sx, -0.35, sz),
      new THREE.Vector3(sx + Math.cos(ang) * bend * 0.24, h * 0.36, sz + Math.sin(ang) * bend * 0.24),
      new THREE.Vector3(sx + Math.cos(ang) * bend * 0.68, h * 0.72, sz + Math.sin(ang) * bend * 0.68),
      new THREE.Vector3(sx + Math.cos(ang) * bend * 1.25, h, sz + Math.sin(ang) * bend * 1.25),
    ];
    const culmGeo = createTaperedSplineTube(pts, 8, 0.056, 0.015, 5);
    culmGeo.translate(pos.x, pos.y, pos.z);
    collector.culmGeos.push(culmGeo);

    for (let s = 0; s < 3; s++) {
      const f = 0.52 + s * 0.21;
      const px = THREE.MathUtils.lerp(pts[1].x, pts[3].x, f);
      const py = THREE.MathUtils.lerp(pts[1].y, pts[3].y, f);
      const pz = THREE.MathUtils.lerp(pts[1].z, pts[3].z, f);
      dummy.position.set(pos.x + px, pos.y + py, pos.z + pz);
      dummy.rotation.set(0.45 + s * 0.12, ang + s * 0.9, (s % 2 === 0 ? 1 : -1) * 0.28);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      collector.bambooSprays.push(dummy.matrix.clone());
    }
  }
}

/** Graceful leaning curved coconut palm batched into shared bark & instanced arched fronds */
function buildCoconutPalm({ pos, height = 6.2, lean = 1.1, seed = 0, collector }) {
  const dir = seed * 1.3;
  const dx = Math.cos(dir) * lean;
  const dz = Math.sin(dir) * lean * 0.65;
  const pts = [
    new THREE.Vector3(0, -0.35, 0),
    new THREE.Vector3(dx * 0.25, height * 0.34, dz * 0.25),
    new THREE.Vector3(dx * 0.65, height * 0.68, dz * 0.65),
    new THREE.Vector3(dx, height, dz),
  ];
  const trunkGeo = createTaperedSplineTube(pts, 10, 0.145, 0.065, 6);
  trunkGeo.translate(pos.x, pos.y, pos.z);
  collector.barkGeos.push(trunkGeo);

  const holder = new THREE.Object3D();
  const frondNode = new THREE.Object3D();
  holder.add(frondNode);

  const fronds = 12;
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + seed;
    holder.position.set(pos.x + dx, pos.y + height, pos.z + dz);
    holder.rotation.set(0, yaw, 0);
    frondNode.rotation.set(0.26 + (f % 3) * 0.19, 0, 0);
    holder.updateMatrixWorld(true);
    collector.palmFronds.push(frondNode.matrixWorld.clone());
  }
}

/** Lush tropical banana plant cluster batched into shared stems & instanced paddle leaves */
function buildBananaCluster({ pos, scale = 1.0, seed = 0, collector }) {
  const holder = new THREE.Object3D();
  const bladeNode = new THREE.Object3D();
  holder.add(bladeNode);

  const stems = 2;
  for (let s = 0; s < stems; s++) {
    const sx = (s - 0.5) * 0.44 * scale;
    const sz = Math.sin(seed + s * 2.4) * 0.30 * scale;
    const h = (1.18 - s * 0.22) * scale;

    const stemPts = [
      new THREE.Vector3(sx, -0.25, sz),
      new THREE.Vector3(sx * 1.15, h * 0.5, sz * 1.15),
      new THREE.Vector3(sx * 1.25, h, sz * 1.25),
    ];
    const stemGeo = createTaperedSplineTube(stemPts, 6, 0.115 * scale, 0.068 * scale, 5);
    stemGeo.translate(pos.x, pos.y, pos.z);
    collector.bananaStemGeos.push(stemGeo);

    const leaves = 8;
    for (let l = 0; l < leaves; l++) {
      const ang = (l / leaves) * Math.PI * 2 + seed + s * 1.1;
      holder.position.set(pos.x + sx * 1.25, pos.y + h * 0.92, pos.z + sz * 1.25);
      holder.rotation.set(0, ang, 0);
      bladeNode.rotation.set(0.38 + (l % 3) * 0.20, 0, 0);
      bladeNode.scale.setScalar(scale);
      holder.updateMatrixWorld(true);
      collector.bananaLeaves.push(bladeNode.matrixWorld.clone());
    }
  }
}

/** Volumetric 3D shrub mound batched into instanced canopy domes */
function buildShrubCluster({ pos, scale = 1.0, seed = 0, collector }) {
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 4; i++) {
    const sc = (0.72 - i * 0.07) * scale;
    const ang = (i / 4) * Math.PI * 2 + seed;
    dummy.position.set(
      pos.x + Math.cos(ang) * 0.24 * scale,
      pos.y + 0.12 * scale + (i === 3 ? 0.18 * scale : 0),
      pos.z + Math.sin(ang) * 0.24 * scale
    );
    dummy.rotation.set(0.22, ang, (i % 2 === 0 ? 1 : -1) * 0.15);
    dummy.scale.set(sc, sc * 1.15, sc);
    dummy.updateMatrix();
    collector.leafBuckets[i % 3].push(dummy.matrix.clone());
  }
}

/**
 * Instanced Dense Tropical Hillside Canopy & Shrubbery Layer (400+ lush 3D foliage crowns)
 * Automatically avoids roads, streams, rice terraces, vegetable beds, and Machang hut footprints.
 */
function populateDenseHillsideCanopy({ mode, isDay, collector }) {
  const roadCurves = (
    isDay
      ? [DAY_ROAD_UVS, DAY_LEFT_TRAIL_UVS, DAY_STREAM_UVS]
      : [NIGHT_ROAD_UVS, NIGHT_VALLEY_ROAD_UVS, NIGHT_STREAM_UVS]
  ).map((uvs) => uvs.map(([u, v]) => solveTerrainAtUV(u, v, mode, 0)));

  // Hut & waterfall cliff exclusion centers (in UV) so trees/bushes frame huts & cascade without clipping
  const hutUVs = isDay
    ? [
        [0.932, 0.752], [0.842, 0.774], [0.594, 0.852], [0.556, 0.664],
        [0.390, 0.785], [0.460, 0.706], [0.592, 0.576], [0.720, 0.555],
        [0.674, 0.506], [0.758, 0.480], [0.818, 0.438], [0.892, 0.458],
        [0.960, 0.408], [0.79, 0.625], [0.852, 0.910], [0.352, 0.455],
      ]
    : [
        [0.138, 0.748], [0.872, 0.658], [0.770, 0.512], [0.850, 0.468],
        [0.848, 0.422], [0.686, 0.474], [0.630, 0.506], [0.588, 0.562],
        [0.52, 0.67], [0.56, 0.604], [0.653, 0.536],
      ];
  const exclusionPts = hutUVs.map(([u, v]) => solveTerrainAtUV(u, v, mode, 0));

  function isClearXZ(x, z, roadPad = 2.0, hutPad = 2.9) {
    for (const ep of exclusionPts) {
      if (Math.hypot(x - ep.x, z - ep.z) < hutPad) return false;
    }
    for (const poly of roadCurves) {
      for (let k = 0; k < poly.length - 1; k++) {
        const a = poly[k];
        const b = poly[k + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        const px = a.x + dx * t;
        const pz = a.z + dz * t;
        if (Math.hypot(x - px, z - pz) < roadPad) return false;
      }
    }
    return true;
  }

  const dummy = new THREE.Object3D();

  // Dense UV zones matching exact vegetated slopes & margins
  const zones = isDay
    ? [
        { u0: 0.01, u1: 0.34, v0: 0.43, v1: 0.96, count: 185, scMin: 1.05, scMax: 2.45 },
        { u0: 0.36, u1: 0.60, v0: 0.43, v1: 0.72, count: 100, scMin: 0.95, scMax: 2.15 },
        { u0: 0.02, u1: 0.66, v0: 0.84, v1: 0.99, count: 72, scMin: 0.75, scMax: 1.45 },
        { u0: 0.60, u1: 0.99, v0: 0.34, v1: 0.66, count: 120, scMin: 1.0, scMax: 2.25 },
        { u0: 0.88, u1: 0.99, v0: 0.62, v1: 0.98, count: 38, scMin: 0.85, scMax: 1.65 },
      ]
    : [
        { u0: 0.01, u1: 0.34, v0: 0.46, v1: 0.98, count: 145, scMin: 0.95, scMax: 2.3 },
        { u0: 0.24, u1: 0.56, v0: 0.46, v1: 0.62, count: 75, scMin: 0.9, scMax: 2.0 },
        { u0: 0.02, u1: 0.99, v0: 0.84, v1: 0.99, count: 88, scMin: 0.75, scMax: 1.5 },
        { u0: 0.56, u1: 0.99, v0: 0.34, v1: 0.82, count: 135, scMin: 0.95, scMax: 2.35 },
      ];

  let idxCounter = 0;
  for (const z of zones) {
    for (let k = 0; k < z.count; k++) {
      idxCounter++;
      const u = THREE.MathUtils.lerp(z.u0, z.u1, seeded(idxCounter, 1));
      const v = THREE.MathUtils.lerp(z.v0, z.v1, seeded(idxCounter, 2));
      const p = solveTerrainAtUV(u, v, mode, 0);
      if (p.z < -82 || p.z > 14) continue;
      if (!isClearXZ(p.x, p.z, v > 0.78 ? 1.85 : 1.55, 2.75)) continue;

      const sc = THREE.MathUtils.lerp(z.scMin, z.scMax, seeded(idxCounter, 3));
      const yaw = seeded(idxCounter, 4) * Math.PI * 2;
      const tilt = (seeded(idxCounter, 5) - 0.5) * 0.35;
      const lift = sc * (0.25 + seeded(idxCounter, 6) * 0.35);

      dummy.position.set(p.x, terrainHeightAt(p.x, p.z, mode) + lift, p.z);
      dummy.rotation.set(tilt, yaw, -tilt * 0.8);
      dummy.scale.set(sc * 1.15, sc * 1.25, sc * 1.15);
      dummy.updateMatrix();
      collector.leafBuckets[idxCounter % collector.leafBuckets.length].push(dummy.matrix.clone());
    }
  }
}

export function createFoliageForMode(mode = "dark", opts = {}) {
  const isDay = mode === "light";
  const isMobile = Boolean(opts.isMobile);
  const castLeafShadow = true;
  const group = new THREE.Group();
  const windMats = [];

  const barkMaps = getBarkMaps(isDay);
  const barkMat = new THREE.MeshStandardMaterial({
    map: barkMaps.map,
    normalMap: barkMaps.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: 0.90,
  });

  const bambooMat = new THREE.MeshStandardMaterial({
    map: getBambooCulmTexture(isDay),
    roughness: 0.72,
  });

  const bananaStemMat = new THREE.MeshStandardMaterial({
    color: isDay ? 0x5c8030 : 0x1e301b,
    roughness: 0.78,
  });

  const domeGeo = buildCuppedCanopyGeometry(1.0, 0.54);

  const leafMats = [0, 1, 2].map((variant) => {
    const m = new THREE.MeshStandardMaterial({
      map: getBroadleafClusterTexture(isDay, variant),
      alphaTest: 0.34,
      side: THREE.DoubleSide,
      roughness: 0.82,
    });
    attachWindSwayShader(m, 0.088, 1.55 + variant * 0.18, variant * 2.1, true);
    windMats.push(m);
    return m;
  });

  const bambooSprayMat = new THREE.MeshStandardMaterial({
    map: getBambooSprayTexture(isDay),
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.78,
  });
  attachWindSwayShader(bambooSprayMat, 0.082, 1.65, 1.4);
  windMats.push(bambooSprayMat);

  const bananaLeafMat = new THREE.MeshStandardMaterial({
    map: getBananaLeafTexture(isDay),
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.72,
  });
  attachWindSwayShader(bananaLeafMat, 0.072, 1.50, 2.7);
  windMats.push(bananaLeafMat);

  const palmFrondMat = new THREE.MeshStandardMaterial({
    map: getPalmFrondTexture(isDay),
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.76,
  });
  attachWindSwayShader(palmFrondMat, 0.088, 1.40, 3.8);
  windMats.push(palmFrondMat);

  const collector = {
    barkGeos: [],
    culmGeos: [],
    bananaStemGeos: [],
    leafBuckets: [[], [], []],
    bambooSprays: [],
    palmFronds: [],
    bananaLeaves: [],
  };

  if (!isDay) {
    // NIGHT FOLIAGE — Rich dense tropical hillside jungle matching Night reference
    for (const [u, v, h, c, s] of [
      [0.045, 0.66, 7.8, 10, 0.8],
      [0.095, 0.60, 7.4, 9, 1.5],
      [0.145, 0.56, 7.2, 9, 2.4],
      [0.215, 0.59, 6.9, 9, 3.1],
      [0.265, 0.62, 6.4, 8, 3.8],
      [0.642, 0.41, 4.9, 7, 4.2],
    ]) {
      buildBambooClump({ pos: solveTerrainAtUV(u, v, "dark"), height: h, culms: c, seed: s, collector });
    }

    for (const [u, v, h, l, s] of [
      [0.195, 0.50, 6.5, 1.0, 0.8],
      [0.955, 0.34, 6.0, -1.1, 2.5],
      [0.540, 0.52, 4.6, 0.7, 3.9],
    ]) {
      buildCoconutPalm({ pos: solveTerrainAtUV(u, v, "dark"), height: h, lean: l, seed: s, collector });
    }

    // Hero broadleaf jungle trees across left bluff, mid ridge, and entire right hillside
    for (const [u, v, h, sp, s] of [
      [0.04, 0.44, 6.6, 3.4, 1.2],
      [0.11, 0.48, 5.4, 2.8, 1.8],
      [0.575, 0.46, 4.8, 2.5, 2.1],
      [0.67, 0.43, 4.9, 2.5, 2.7],
      [0.72, 0.41, 5.1, 2.6, 3.3],
      [0.78, 0.39, 5.4, 2.7, 4.1],
      [0.85, 0.37, 5.8, 2.9, 4.6],
      [0.91, 0.38, 6.4, 3.3, 5.0],
      [0.96, 0.46, 6.1, 3.2, 5.7],
      [0.96, 0.55, 5.8, 3.1, 6.2],
      [0.94, 0.72, 5.4, 2.9, 7.1],
      [0.73, 0.62, 4.2, 2.2, 7.8],
      [0.61, 0.71, 3.8, 2.1, 8.4],
    ]) {
      buildOrganicBroadleafTree({ pos: solveTerrainAtUV(u, v, "dark"), height: h, spread: sp, seed: s, collector });
    }

    for (const [u, v, sc, s] of [
      [0.285, 0.74, 0.96, 1.2],
      [0.370, 0.87, 1.12, 1.9],
      [0.545, 0.72, 0.88, 2.7],
      [0.640, 0.67, 0.85, 4.5],
      [0.805, 0.48, 0.86, 5.1],
      [0.925, 0.62, 1.02, 2.3],
      [0.935, 0.86, 1.32, 3.4],
      [0.890, 0.92, 1.25, 6.1],
    ]) {
      buildBananaCluster({ pos: solveTerrainAtUV(u, v, "dark"), scale: sc, seed: s, collector });
    }

    for (const [u, v, sc, s] of [
      [0.06, 0.89, 1.45, 1],
      [0.14, 0.94, 1.35, 2],
      [0.26, 0.95, 1.30, 3],
      [0.34, 0.95, 1.35, 4],
      [0.48, 0.94, 1.40, 5],
      [0.62, 0.86, 1.20, 6],
      [0.86, 0.90, 1.35, 7],
      [0.54, 0.75, 1.05, 8],
      [0.76, 0.62, 0.95, 9],
    ]) {
      buildShrubCluster({ pos: solveTerrainAtUV(u, v, "dark"), scale: sc, seed: s, collector });
    }
  } else {
    // DAY FOLIAGE — Dense FG Left Banana & Palm Jungle, Mid Bamboo & Rich Right Hillside Forest
    for (const [u, v, sc, s] of [
      [0.04, 0.90, 1.42, 0.7],
      [0.08, 0.88, 1.40, 1.1],
      [0.16, 0.86, 1.46, 2.2],
      [0.23, 0.92, 1.32, 3.3],
      [0.44, 0.91, 1.24, 4.4],
      [0.94, 0.56, 0.98, 5.5],
      [0.91, 0.64, 0.95, 6.6],
      [0.95, 0.48, 0.88, 7.2],
      [0.85, 0.39, 0.86, 8.1],
    ]) {
      buildBananaCluster({ pos: solveTerrainAtUV(u, v, "light"), scale: sc, seed: s, collector });
    }

    for (const [u, v, h, c, s] of [
      [0.43, 0.61, 6.9, 10, 1.8],
      [0.47, 0.59, 6.0, 8, 2.5],
      [0.51, 0.58, 5.4, 7, 3.1],
    ]) {
      buildBambooClump({ pos: solveTerrainAtUV(u, v, "light"), height: h, culms: c, seed: s, collector });
    }

    for (const [u, v, h, l, s] of [
      [0.09, 0.76, 6.2, 0.9, 1.2],
      [0.15, 0.74, 5.9, -0.7, 2.6],
      [0.21, 0.75, 5.6, 0.6, 3.2],
      [0.82, 0.35, 5.8, 0.8, 3.9],
      [0.89, 0.33, 6.2, -0.9, 5.1],
    ]) {
      buildCoconutPalm({ pos: solveTerrainAtUV(u, v, "light"), height: h, lean: l, seed: s, collector });
    }

    for (const [u, v, h, sp, s] of [
      [0.04, 0.74, 5.9, 3.1, 1.0],
      [0.12, 0.68, 4.9, 2.6, 1.5],
      [0.20, 0.56, 5.2, 2.6, 1.6],
      [0.27, 0.54, 4.9, 2.5, 2.0],
      [0.25, 0.76, 4.6, 2.4, 1.8],
      [0.29, 0.88, 4.6, 2.5, 2.1],
      [0.39, 0.63, 4.9, 2.4, 3.2],
      [0.44, 0.52, 4.8, 2.4, 3.4],
      [0.54, 0.49, 4.9, 2.5, 3.6],
      [0.64, 0.45, 4.6, 2.3, 3.8],
      [0.70, 0.42, 5.4, 2.7, 4.3],
      [0.79, 0.39, 5.0, 2.5, 5.4],
      [0.86, 0.37, 5.5, 2.8, 5.9],
      [0.95, 0.32, 6.4, 3.3, 6.5],
      [0.96, 0.46, 5.2, 2.7, 7.0],
      [0.86, 0.54, 4.3, 2.2, 7.6],
    ]) {
      buildOrganicBroadleafTree({ pos: solveTerrainAtUV(u, v, "light"), height: h, spread: sp, seed: s, collector });
    }

    for (const [u, v, sc, s] of [
      [0.33, 0.95, 1.32, 1],
      [0.52, 0.95, 1.25, 2],
      [0.68, 0.80, 1.02, 3],
      [0.88, 0.66, 0.96, 4],
      [0.21, 0.78, 1.18, 5],
      [0.61, 0.72, 0.95, 6],
      [0.31, 0.50, 1.10, 7],
      [0.38, 0.51, 1.05, 8],
      [0.28, 0.62, 1.12, 9],
      [0.17, 0.51, 1.25, 10],
      [0.49, 0.49, 1.15, 11],
      [0.59, 0.46, 1.10, 12],
    ]) {
      buildShrubCluster({ pos: solveTerrainAtUV(u, v, "light"), scale: sc, seed: s, collector });
    }
  }

  // Dense instanced 3D foliage crowns & shrubs blanketing valleys, ridges & verges
  populateDenseHillsideCanopy({ mode, isDay, collector });

  // Emit batched static trunks/culms/stems (3 total draw calls)
  const mergedBark = mergeStaticGeos(collector.barkGeos);
  if (mergedBark) {
    const m = new THREE.Mesh(mergedBark, barkMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  const mergedCulms = mergeStaticGeos(collector.culmGeos);
  if (mergedCulms) {
    const m = new THREE.Mesh(mergedCulms, bambooMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  const mergedStems = mergeStaticGeos(collector.bananaStemGeos);
  if (mergedStems) {
    const m = new THREE.Mesh(mergedStems, bananaStemMat);
    m.castShadow = castLeafShadow;
    m.receiveShadow = true;
    group.add(m);
  }

  // Emit batched instanced canopies, bamboo sprays, palm fronds, and banana blades (6 total draw calls)
  const emitInst = (geo, mat, mats, castShad) => {
    if (!mats.length) {
      geo.dispose();
      return;
    }
    const inst = new THREE.InstancedMesh(geo, mat, mats.length);
    for (let i = 0; i < mats.length; i++) inst.setMatrixAt(i, mats[i]);
    inst.castShadow = castShad;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  };

  collector.leafBuckets.forEach((mats, bIdx) => {
    if (!mats.length) return;
    const inst = new THREE.InstancedMesh(domeGeo, leafMats[bIdx], mats.length);
    for (let i = 0; i < mats.length; i++) inst.setMatrixAt(i, mats[i]);
    inst.castShadow = !isMobile;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  });

  const sprayGeo = buildCuppedCanopyGeometry(0.92, 0.34);
  emitInst(sprayGeo, bambooSprayMat, collector.bambooSprays, castLeafShadow);

  const palmFrondGeo = new THREE.PlaneGeometry(1.18, 2.40, 4, 8);
  palmFrondGeo.translate(0, 1.18, 0);
  const fp = palmFrondGeo.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i);
    const y = fp.getY(i);
    const t = y / 2.40;
    const crease = Math.abs(x) * -0.18;
    fp.setZ(i, Math.sin(t * Math.PI * 0.7) * 0.44 - t * t * 0.98 + crease);
    fp.setY(i, Math.sin(t * Math.PI * 0.58) * 1.88);
  }
  palmFrondGeo.computeVertexNormals();
  emitInst(palmFrondGeo, palmFrondMat, collector.palmFronds, castLeafShadow);

  const bananaBladeGeo = new THREE.PlaneGeometry(0.74, 1.95, 4, 8);
  bananaBladeGeo.translate(0, 0.97, 0);
  const bp = bananaBladeGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i);
    const y = bp.getY(i);
    const t = y / 1.95;
    const midribV = Math.abs(x) * 0.22;
    bp.setZ(i, Math.sin(t * 2.15) * 0.26 - t * t * 0.62 - midribV);
  }
  bananaBladeGeo.computeVertexNormals();
  emitInst(bananaBladeGeo, bananaLeafMat, collector.bananaLeaves, castLeafShadow);

  // Animated 3D fluttering butterflies (Projapoti) over foreground flowers, shrubs & gardens
  const butterflies = buildButterfliesForMode(mode, isDay, group);

  return {
    group,
    update(timeSec) {
      for (const m of windMats) {
        if (m.userData?.uTime) m.userData.uTime.value = timeSec;
      }
      butterflies.update(timeSec);
    },
    dispose() {
      group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    },
  };
}

/** Articulated 3D butterflies (Projapoti) with hinged painted wings fluttering along looping paths */
function buildButterfliesForMode(mode, isDay, group) {
  const rightWingGeo = new THREE.PlaneGeometry(0.14, 0.14);
  rightWingGeo.translate(0.07, 0, 0);
  rightWingGeo.rotateX(-Math.PI * 0.5);

  const leftWingGeo = rightWingGeo.clone();
  leftWingGeo.scale(-1, 1, 1);

  const bodyGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.002, -0.05),
      new THREE.Vector2(0.009, 0.0),
      new THREE.Vector2(0.007, 0.045),
      new THREE.Vector2(0.002, 0.06),
    ],
    5
  );
  bodyGeo.rotateX(Math.PI * 0.5);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1e1814 });

  const wingMats = [0, 1, 2, 3].map(
    (idx) =>
      new THREE.MeshBasicMaterial({
        map: getButterflyWingTexture(idx),
        alphaTest: 0.25,
        side: THREE.DoubleSide,
      })
  );

  // Foreground & midground fluttering anchor spots (UVs near flowers, banana groves, garden & paths)
  const spots = isDay
    ? [
        [0.14, 0.87, 0.7, 0], [0.19, 0.90, 0.6, 1], [0.28, 0.93, 0.5, 2],
        [0.37, 0.91, 0.6, 0], [0.47, 0.89, 0.7, 3], [0.55, 0.92, 0.5, 1],
        [0.64, 0.87, 0.6, 0], [0.71, 0.82, 0.7, 2], [0.77, 0.76, 0.8, 1],
        [0.80, 0.63, 0.6, 0], [0.75, 0.61, 0.7, 3], [0.83, 0.65, 0.5, 2],
        [0.66, 0.70, 0.6, 1], [0.89, 0.84, 0.7, 0], [0.42, 0.82, 0.8, 2],
        [0.24, 0.82, 0.8, 3], [0.51, 0.75, 0.7, 0], [0.92, 0.90, 0.6, 1],
      ]
    : [
        [0.18, 0.81, 0.8, 3], [0.23, 0.84, 0.6, 1], [0.58, 0.63, 0.6, 3],
        [0.84, 0.73, 0.7, 3], [0.74, 0.77, 0.6, 1], [0.45, 0.88, 0.6, 3],
      ];

  const items = [];
  for (let i = 0; i < spots.length; i++) {
    const [u, v, yLift, pal] = spots[i];
    const base = solveTerrainAtUV(u, v, mode, yLift);
    const holder = new THREE.Group();
    const scale = isDay ? 1.05 + (i % 3) * 0.22 : 0.88;
    holder.scale.setScalar(scale);

    const wMat = wingMats[pal % wingMats.length];
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    const lWing = new THREE.Mesh(leftWingGeo, wMat);
    const rWing = new THREE.Mesh(rightWingGeo, wMat);
    holder.add(body, lWing, rWing);
    group.add(holder);

    items.push({
      holder,
      lWing,
      rWing,
      base,
      rx: 0.55 + (i % 4) * 0.22,
      rz: 0.45 + (i % 3) * 0.20,
      speed: 0.75 + (i % 5) * 0.14,
      flapHz: 10.5 + (i % 4) * 1.4,
      phase: i * 1.47,
    });
  }

  return {
    update(timeSec) {
      for (const b of items) {
        const t = timeSec * b.speed + b.phase;
        const x = b.base.x + Math.sin(t) * b.rx;
        const z = b.base.z + Math.sin(t * 2.0 + 0.6) * b.rz * 0.65;
        const y = b.base.y + Math.sin(t * 2.6 + b.phase) * 0.28 + Math.cos(t * 4.2) * 0.08;

        const dx = Math.cos(t) * b.rx * b.speed;
        const dz = Math.cos(t * 2.0 + 0.6) * 2.0 * b.rz * 0.65 * b.speed;

        b.holder.position.set(x, y, z);
        b.holder.lookAt(x + dx, y, z + dz);

        const flutter = 0.22 + 0.92 * Math.sin(timeSec * b.flapHz + b.phase);
        b.lWing.rotation.z = -flutter;
        b.rWing.rotation.z = flutter;
      }
    },
  };
}

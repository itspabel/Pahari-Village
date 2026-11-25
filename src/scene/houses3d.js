/**
 * src/scene/houses3d.js — Architectural-Grade 3D Pahari Machang Stilt Houses,
 * Structural Split-Bamboo Framing, X-Braced Stilts, Multi-Tiered Ragged Thatch & Corrugated Tin Roofs,
 * Exposed Rafters, Ladders, Under-Deck Baskets & Firewood, Chimneys with Smoke, Fences & Laundry.
 */

import * as THREE from "three";
import { solveTerrainAtUV, terrainHeightAt } from "./terrain3d.js";
import {
  getBambooWallMaps,
  getThatchMaps,
  getCorrugatedTinMaps,
  getBambooCulmTexture,
  getBarkMaps,
  getWarmWindowTexture,
  getMistWispTexture,
  getSoftGlowTexture,
} from "./textures3d.js";

/** Tapered bamboo stilt with realistic node collars via LatheGeometry */
function createBambooStiltGeometry(radius, height) {
  const pts = [];
  const segments = 10;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t * height;
    const taper = 1.09 - t * 0.17;
    const nodeBulge = i === 3 || i === 6 || i === 9 ? 1.19 : 1.0;
    pts.push(new THREE.Vector2(radius * taper * nodeBulge, y));
  }
  return new THREE.LatheGeometry(pts, 9);
}

/** Woven bamboo storage basket placed under Machang stilts */
function createWovenBasket(mat, scale = 1.0) {
  const pts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.16 * scale, 0.02 * scale),
    new THREE.Vector2(0.24 * scale, 0.18 * scale),
    new THREE.Vector2(0.26 * scale, 0.34 * scale),
    new THREE.Vector2(0.22 * scale, 0.42 * scale),
    new THREE.Vector2(0.19 * scale, 0.42 * scale),
  ];
  const geo = new THREE.LatheGeometry(pts, 12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Multi-tiered overhanging ragged thatch roof + exposed eaves rafters */
function createOrganicThatchRoof(width, length, ridgeHeight, thatchMat, rafterMat) {
  const group = new THREE.Group();

  function buildThatchLayer(wHalf, lHalf, rHeight, yShift, sagScale) {
    const segX = 14;
    const segZ = 18;
    const geo = new THREE.BufferGeometry();
    const verts = [];
    const uvs = [];
    const indices = [];

    for (let iz = 0; iz <= segZ; iz++) {
      const tz = iz / segZ;
      const z = -lHalf + tz * lHalf * 2;
      for (let ix = 0; ix <= segX; ix++) {
        const tx = ix / segX;
        const sx = (tx - 0.5) * 2;
        const absX = Math.abs(sx);
        const ragged =
          absX > 0.80
            ? Math.sin(tz * 48.0 + sx * 11.0) * 0.068 + Math.cos(tz * 81.0 + yShift * 14.0) * 0.036
            : 0;
        const sag = Math.sin(tz * Math.PI) * -0.045 * absX * sagScale;
        const x = sx * (wHalf + ragged);
        const y = yShift + rHeight * (1.0 - Math.pow(absX, 0.90)) + sag;
        verts.push(x, y, z);
        uvs.push(tx * 1.15, tz * 1.55);
      }
    }

    for (let iz = 0; iz < segZ; iz++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = iz * (segX + 1) + ix;
        const b = a + 1;
        const c = (iz + 1) * (segX + 1) + ix;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const m = new THREE.Mesh(geo, thatchMat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // Lower thick eave skirt + upper layered straw cap
  group.add(buildThatchLayer(width * 0.585, length * 0.56, ridgeHeight * 0.92, -0.03, 1.0));
  group.add(buildThatchLayer(width * 0.495, length * 0.535, ridgeHeight * 0.98, 0.06, 0.75));

  // Exposed bamboo eaves rafters supporting underside of thatch overhang
  const slopeAngle = Math.atan2(ridgeHeight * 0.92, width * 0.56);
  const slopeLen = Math.hypot(width * 0.56, ridgeHeight * 0.92);
  const rafterCount = 5;
  for (let r = 0; r < rafterCount; r++) {
    const rz = THREE.MathUtils.lerp(-length * 0.48, length * 0.48, r / (rafterCount - 1));
    for (const side of [-1, 1]) {
      const rafter = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.042, 0.045), rafterMat);
      rafter.position.set(side * width * 0.28, ridgeHeight * 0.45 - 0.06, rz);
      rafter.rotation.z = -side * slopeAngle;
      group.add(rafter);
    }
  }

  // Thick bound ridge straw bundle along roof peak
  const hl = length * 0.56;
  const ridgeGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.02, -hl * 1.02),
      new THREE.Vector2(0.115, -hl * 0.85),
      new THREE.Vector2(0.125, 0),
      new THREE.Vector2(0.115, hl * 0.85),
      new THREE.Vector2(0.02, hl * 1.02),
    ],
    9
  );
  ridgeGeo.rotateX(Math.PI * 0.5);
  const ridgeMesh = new THREE.Mesh(ridgeGeo, thatchMat);
  ridgeMesh.position.y = ridgeHeight + 0.03;
  ridgeMesh.castShadow = true;
  group.add(ridgeMesh);

  return group;
}

/** Ribbed corrugated sheet-metal gable roof with ridge cap & exposed timber fascia */
function createCorrugatedTinRoof(width, length, ridgeHeight, tinMat, beamMat) {
  const group = new THREE.Group();
  const hw = width * 0.57;
  const hl = length * 0.545;
  const slopeLen = Math.hypot(hw, ridgeHeight);
  const angle = Math.atan2(ridgeHeight, hw);

  for (const side of [-1, 1]) {
    const sheetGeo = new THREE.BoxGeometry(slopeLen, 0.04, hl * 2);
    const sheet = new THREE.Mesh(sheetGeo, tinMat);
    sheet.position.set(side * hw * 0.5, ridgeHeight * 0.5, 0);
    sheet.rotation.z = -side * angle;
    sheet.castShadow = true;
    sheet.receiveShadow = true;
    group.add(sheet);

    // Timber eave purlin trim under metal lip
    const purlin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, hl * 2.01), beamMat);
    purlin.position.set(side * (hw - 0.06), -0.02, 0);
    group.add(purlin);
  }

  // Metal standing-seam ridge flashing cap
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, hl * 2.02), tinMat);
  cap.position.set(0, ridgeHeight + 0.015, 0);
  group.add(cap);

  return group;
}

/** Multi-part realistic Pahari Machang bamboo-stilt house */
function buildMachangHut({
  pos,
  yaw = 0,
  width = 2.4,
  length = 3.0,
  stiltHeight = 1.05,
  wallHeight = 1.45,
  ridgeHeight = 1.15,
  roofType = "thatch",
  isDay = false,
  hasPorch = true,
  hasLadder = true,
  ladderSide = "front",
  hasChimney = false,
  hasLaundry = false,
  hasGlowingWindows = true,
  isOpenShed = false,
  isHero = false,
  hasPointLight = false,
  smokeCollectors = [],
  laundryTargets = [],
  nightLights = [],
}) {
  const hut = new THREE.Group();
  hut.position.copy(pos);
  hut.rotation.y = yaw;

  const wallMaps = getBambooWallMaps(isDay);
  const thatchMaps = getThatchMaps(isDay);
  const tinMaps = getCorrugatedTinMaps();
  const barkMaps = getBarkMaps(isDay);
  const culmTex = getBambooCulmTexture(isDay);

  const wallMat = new THREE.MeshStandardMaterial({
    map: wallMaps.map,
    normalMap: wallMaps.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughness: 0.88,
    metalness: 0.0,
  });

  const timberMat = new THREE.MeshStandardMaterial({
    map: barkMaps.map,
    normalMap: barkMaps.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    color: isDay ? 0x866942 : 0x3b2f21,
    roughness: 0.86,
  });

  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: isDay ? 0x4b3823 : 0x241c13,
    roughness: 0.88,
  });

  const bambooPostMat = new THREE.MeshStandardMaterial({
    map: culmTex,
    color: isDay ? 0xbca674 : 0x62543a,
    roughness: 0.78,
  });

  const thatchMat = new THREE.MeshStandardMaterial({
    map: thatchMaps.map,
    normalMap: thatchMaps.normalMap,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughness: 0.94,
    side: THREE.DoubleSide,
  });

  const tinMat = new THREE.MeshStandardMaterial({
    map: tinMaps.map,
    normalMap: tinMaps.normalMap,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughness: 0.44,
    metalness: 0.56,
  });

  const stiltGeo = createBambooStiltGeometry(0.056, stiltHeight + 0.65);
  const fullPostGeo = createBambooStiltGeometry(0.058, stiltHeight + wallHeight + 0.35);

  const hw = width * 0.5;
  const hl = length * 0.5;
  const porchDepth = hasPorch ? length * 0.36 : 0;
  const zFront = hl + porchDepth;

  // 1. Substructure bamboo stilts deeply rooted into hillside
  const stiltCoords = [
    [-hw, -hl],
    [0, -hl],
    [hw, -hl],
    [-hw, 0],
    [hw, 0],
    [-hw, hl],
    [0, hl],
    [hw, hl],
  ];
  if (hasPorch) {
    stiltCoords.push([-hw, zFront], [0, zFront], [hw, zFront]);
  }

  for (const [sx, sz] of stiltCoords) {
    const isCorner =
      Math.abs(sx) > 0.1 &&
      (Math.abs(sz + hl) < 0.1 || Math.abs(sz - hl) < 0.1 || Math.abs(sz - zFront) < 0.1);
    const mesh = new THREE.Mesh(isCorner && !hasPorch ? fullPostGeo : stiltGeo, bambooPostMat);
    mesh.position.set(sx, -0.65, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    hut.add(mesh);
  }

  // Diagonal X-brace cross struts under tall front & side stilts (distinctive Machang engineering!)
  if (stiltHeight > 0.78) {
    const braceLen = Math.hypot(width * 0.85, stiltHeight * 0.75);
    const braceAng = Math.atan2(stiltHeight * 0.75, width * 0.85);
    for (const side of [-1, 1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(braceLen, 0.042, 0.042), bambooPostMat);
      brace.position.set(0, stiltHeight * 0.46, zFront - 0.02);
      brace.rotation.z = side * braceAng;
      hut.add(brace);
    }
  }

  // Cross-bracing floor joists & edge beams
  for (const fz of [-hl, 0, hl, ...(hasPorch ? [zFront] : [])]) {
    const joist = new THREE.Mesh(new THREE.BoxGeometry(width + 0.22, 0.085, 0.085), timberMat);
    joist.position.set(0, stiltHeight - 0.04, fz);
    hut.add(joist);
  }
  for (const fx of [-hw, hw]) {
    const sideBeam = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.095, length + porchDepth + 0.20), timberMat);
    sideBeam.position.set(fx, stiltHeight - 0.02, porchDepth * 0.5);
    hut.add(sideBeam);
  }

  // 2. Raised Split-Bamboo Planked Machang Deck
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.20, 0.08, length + porchDepth + 0.20),
    timberMat
  );
  deck.position.set(0, stiltHeight + 0.02, porchDepth * 0.5);
  deck.castShadow = true;
  deck.receiveShadow = true;
  hut.add(deck);

  // Under-deck woven grain baskets & split firewood stack (hero & mid huts)
  if (isHero && !isOpenShed) {
    const basket = createWovenBasket(wallMat, 0.88);
    basket.position.set(-hw * 0.42, 0.04, hl * 0.55);
    hut.add(basket);

    const logGeo = createBambooStiltGeometry(0.042, 0.52);
    logGeo.rotateZ(Math.PI * 0.5);
    for (let l = 0; l < 4; l++) {
      const log = new THREE.Mesh(logGeo, timberMat);
      log.position.set(hw * 0.34, 0.06 + Math.floor(l / 2) * 0.06, hl * 0.3 + (l % 2) * 0.08);
      hut.add(log);
    }
  }

  // 3. Enclosed Woven Bamboo Walls + External Structural Timber Ribs
  if (!isOpenShed) {
    const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, length), wallMat);
    bodyBox.position.set(0, stiltHeight + wallHeight * 0.5 + 0.05, 0);
    bodyBox.castShadow = true;
    bodyBox.receiveShadow = true;
    hut.add(bodyBox);

    // Exposed vertical bamboo wall battens & horizontal waist/eave rails
    for (const rx of [-hw - 0.015, hw + 0.015]) {
      for (const hFrac of [0.35, 0.96]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.045, length + 0.04), darkTrimMat);
        rail.position.set(rx, stiltHeight + wallHeight * hFrac + 0.05, 0);
        hut.add(rail);
      }
      for (const rz of [-hl + 0.02, 0, hl - 0.02]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.042, wallHeight + 0.05, 0.042), darkTrimMat);
        post.position.set(rx, stiltHeight + wallHeight * 0.5 + 0.05, rz);
        hut.add(post);
      }
    }
    for (const hFrac of [0.35, 0.96]) {
      const fRail = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.045, 0.036), darkTrimMat);
      fRail.position.set(0, stiltHeight + wallHeight * hFrac + 0.05, hl + 0.015);
      hut.add(fRail);
    }

    // Gable triangular end walls
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-hw, 0);
    gableShape.lineTo(hw, 0);
    gableShape.lineTo(0, ridgeHeight);
    gableShape.closePath();
    const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: length, bevelEnabled: false });
    gableGeo.translate(0, 0, -hl);
    const gableMesh = new THREE.Mesh(gableGeo, wallMat);
    gableMesh.position.y = stiltHeight + wallHeight + 0.04;
    hut.add(gableMesh);

    // Doorway & Warm Glowing Windows with Wooden Frames
    const winTex = getWarmWindowTexture();
    const glowMat = new THREE.MeshBasicMaterial({
      map: winTex,
      color: isDay ? 0x261d14 : 0xffcf78,
    });

    const doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.34, wallHeight * 0.72, 0.06),
      darkTrimMat
    );
    doorFrame.position.set(-width * 0.12, stiltHeight + wallHeight * 0.38 + 0.05, hl + 0.012);
    hut.add(doorFrame);

    const door = new THREE.Mesh(new THREE.BoxGeometry(width * 0.27, wallHeight * 0.64, 0.075), glowMat);
    door.position.set(-width * 0.12, stiltHeight + wallHeight * 0.36 + 0.05, hl + 0.018);
    hut.add(door);

    if (hasGlowingWindows) {
      for (const side of [-1, 1]) {
        const wFrame = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, wallHeight * 0.36, length * 0.28),
          darkTrimMat
        );
        wFrame.position.set(side * (hw + 0.012), stiltHeight + wallHeight * 0.56 + 0.05, length * 0.08);
        hut.add(wFrame);

        const win = new THREE.Mesh(new THREE.BoxGeometry(0.078, wallHeight * 0.29, length * 0.22), glowMat);
        win.position.set(side * (hw + 0.018), stiltHeight + wallHeight * 0.56 + 0.05, length * 0.08);
        hut.add(win);
      }
      const fwFrame = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.26, wallHeight * 0.32, 0.06),
        darkTrimMat
      );
      fwFrame.position.set(width * 0.24, stiltHeight + wallHeight * 0.58 + 0.05, hl + 0.012);
      hut.add(fwFrame);

      const frontWin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.20, wallHeight * 0.25, 0.078), glowMat);
      frontWin.position.set(width * 0.24, stiltHeight + wallHeight * 0.58 + 0.05, hl + 0.018);
      hut.add(frontWin);

      if (!isDay && (isHero || hasPointLight)) {
        const pt = new THREE.PointLight(0xff9b3e, 2.5, 9.6, 1.68);
        pt.position.set(0, stiltHeight + wallHeight * 0.48, hl + 0.58);
        hut.add(pt);
        nightLights.push({ light: pt, base: 2.5, seed: pos.x * 1.3 + pos.z });
      }
    }
  } else {
    for (const [px, pz] of [[-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl]]) {
      const p = new THREE.Mesh(createBambooStiltGeometry(0.048, wallHeight + 0.12), bambooPostMat);
      p.position.set(px, stiltHeight, pz);
      hut.add(p);
    }
  }

  // 4. Open Porch Veranda Posts, Top Rail & Balusters
  if (hasPorch) {
    for (const px of [-hw, hw]) {
      const p = new THREE.Mesh(createBambooStiltGeometry(0.048, wallHeight + 0.10), bambooPostMat);
      p.position.set(px, stiltHeight, zFront);
      hut.add(p);
    }
    const railH = 0.54;
    const frontRail = new THREE.Mesh(new THREE.BoxGeometry(width * 0.58, 0.048, 0.048), bambooPostMat);
    frontRail.position.set(-width * 0.20, stiltHeight + railH, zFront);
    hut.add(frontRail);

    // Vertical veranda balusters
    for (let b = 0; b < 4; b++) {
      const bx = -hw + 0.18 + b * ((width * 0.45) / 3);
      const bal = new THREE.Mesh(new THREE.BoxGeometry(0.032, railH, 0.032), bambooPostMat);
      bal.position.set(bx, stiltHeight + railH * 0.5, zFront);
      hut.add(bal);
    }

    for (const sx of [-hw, hw]) {
      const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.048, porchDepth), bambooPostMat);
      sideRail.position.set(sx, stiltHeight + railH, hl + porchDepth * 0.5);
      hut.add(sideRail);
    }
  }

  // 5. Roof (Extended over porch)
  const totalRoofLen = length + porchDepth + 0.38;
  const roof =
    roofType === "tin"
      ? createCorrugatedTinRoof(width, totalRoofLen, ridgeHeight, tinMat, darkTrimMat)
      : createOrganicThatchRoof(width, totalRoofLen, ridgeHeight, thatchMat, darkTrimMat);
  roof.position.set(0, stiltHeight + wallHeight + 0.02, porchDepth * 0.5);
  hut.add(roof);

  // 6. Diagonal Wooden / Bamboo Step Ladder
  if (hasLadder) {
    const ladder = new THREE.Group();
    const ladderLen = stiltHeight + 0.56;
    for (const rx of [-0.21, 0.21]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.052, ladderLen, 0.052), timberMat);
      rail.position.set(rx, stiltHeight * 0.44, 0);
      rail.rotation.x = 0.56;
      ladder.add(rail);
    }
    const rungs = 5;
    for (let r = 0; r < rungs; r++) {
      const t = (r + 0.6) / (rungs + 0.4);
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.038, 0.046), timberMat);
      rung.position.set(0, t * stiltHeight * 0.94, (1 - t) * 0.58 - 0.14);
      ladder.add(rung);
    }
    if (ladderSide === "right") {
      ladder.rotation.y = Math.PI * 0.5;
      ladder.position.set(hw + 0.38, 0, porchDepth * 0.35);
    } else if (ladderSide === "left") {
      ladder.rotation.y = -Math.PI * 0.5;
      ladder.position.set(-hw - 0.38, 0, porchDepth * 0.35);
    } else {
      ladder.position.set(width * 0.25, 0, zFront + 0.38);
    }
    hut.add(ladder);
  }

  // 7. Tapered Stovepipe Chimney
  if (hasChimney) {
    const pipeGeo = createBambooStiltGeometry(0.070, 0.98);
    const pipeMat = new THREE.MeshStandardMaterial({
      color: isDay ? 0x45494e : 0x24282e,
      roughness: 0.60,
      metalness: 0.58,
    });
    const pipe = new THREE.Mesh(pipeGeo, pipeMat);
    const chX = width * 0.18;
    const chY = stiltHeight + wallHeight + ridgeHeight * 0.68;
    const chZ = -length * 0.12;
    pipe.position.set(chX, chY, chZ);
    hut.add(pipe);

    const worldSmokeOrigin = new THREE.Vector3(chX, chY + 0.98, chZ);
    hut.updateMatrixWorld(true);
    worldSmokeOrigin.applyMatrix4(hut.matrixWorld);
    smokeCollectors.push(worldSmokeOrigin);
  }

  // 8. Swaying Colorful Veranda Laundry (Day mode)
  if (hasLaundry) {
    const clothColors = [0xc93a32, 0x3b6ca8, 0xd9a838, 0x7b3b68];
    const lineLen = width * 0.78;
    for (let c = 0; c < 3; c++) {
      const clothMat = new THREE.MeshStandardMaterial({
        color: clothColors[c % clothColors.length],
        roughness: 0.85,
        side: THREE.DoubleSide,
      });
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.36, 2, 4), clothMat);
      cloth.position.set(-lineLen * 0.32 + c * 0.38, stiltHeight + wallHeight * 0.62, zFront + 0.04);
      hut.add(cloth);
      laundryTargets.push({ mesh: cloth, seed: c * 1.4 + pos.x });
    }
  }

  return hut;
}

/** Wooden split-rail fence following terrain slope between UV waypoints */
function buildTerrainFence(uvPoints, mode, postMat) {
  const group = new THREE.Group();
  const worldPts = uvPoints.map(([u, v]) => solveTerrainAtUV(u, v, mode, 0));

  for (let i = 0; i < worldPts.length - 1; i++) {
    const a = worldPts[i];
    const b = worldPts[i + 1];
    const segLen = a.distanceTo(b);
    const posts = Math.max(2, Math.round(segLen / 0.85));

    for (let p = 0; p <= posts; p++) {
      if (i > 0 && p === 0) continue;
      const t = p / posts;
      const x = THREE.MathUtils.lerp(a.x, b.x, t);
      const z = THREE.MathUtils.lerp(a.z, b.z, t);
      const y = terrainHeightAt(x, z, mode);
      const post = new THREE.Mesh(createBambooStiltGeometry(0.036, 0.74), postMat);
      post.position.set(x, y - 0.1, z);
      post.rotation.z = Math.sin(x * 3.7 + z) * 0.06;
      post.castShadow = true;
      group.add(post);
    }

    for (const hOff of [0.28, 0.50]) {
      const railGeo = new THREE.BoxGeometry(0.032, 0.038, segLen);
      const rail = new THREE.Mesh(railGeo, postMat);
      rail.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5 + hOff, (a.z + b.z) * 0.5);
      rail.lookAt(b.x, b.y + hOff, b.z);
      rail.castShadow = true;
      group.add(rail);
    }
  }
  return group;
}

/** Stone cooking hearth ring with charred firewood */
function buildStoneHearthRing(pos, stoneMat, woodMat) {
  const hearth = new THREE.Group();
  hearth.position.copy(pos);
  const stoneGeo = new THREE.DodecahedronGeometry(0.09, 0);
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const s = new THREE.Mesh(stoneGeo, stoneMat);
    s.position.set(Math.cos(ang) * 0.24, 0.03, Math.sin(ang) * 0.24);
    s.scale.set(1.2, 0.75, 1.0);
    s.rotation.y = ang;
    hearth.add(s);
  }
  const logGeo = createBambooStiltGeometry(0.032, 0.36);
  logGeo.rotateZ(Math.PI * 0.5);
  for (let l = 0; l < 3; l++) {
    const log = new THREE.Mesh(logGeo, woodMat);
    log.position.set(0, 0.05, 0);
    log.rotation.y = (l / 3) * Math.PI;
    hearth.add(log);
  }
  return hearth;
}

export function createArchitectureForMode(mode = "dark", opts = {}) {
  const isDay = mode === "light";
  const isMobile = Boolean(opts.isMobile);
  const group = new THREE.Group();
  const smokeOrigins = [];
  const laundryItems = [];
  const nightLights = [];
  const hearthGlows = [];
  const embers = [];
  const smokeSprites = [];

  const bambooFenceMat = new THREE.MeshStandardMaterial({
    map: getBambooCulmTexture(isDay),
    color: isDay ? 0xa38754 : 0x5c4c34,
    roughness: 0.85,
  });

  const stoneMat = new THREE.MeshStandardMaterial({
    color: isDay ? 0x6b6760 : 0x2e3136,
    roughness: 0.92,
  });
  const charredWoodMat = new THREE.MeshStandardMaterial({
    color: 0x2b2016,
    roughness: 0.90,
  });

  if (!isDay) {
    // NIGHT MODE — 8 calibrated Machang huts matching reference image positions & angles
    const nightHuts = [
      { u: 0.138, v: 0.748, yaw: 0.58, width: 2.55, length: 3.15, stiltHeight: 1.06, wallHeight: 1.48, ridgeHeight: 1.15, hasPorch: true, hasLadder: true, ladderSide: "front", isHero: true },
      { u: 0.872, v: 0.658, yaw: -0.64, width: 2.45, length: 2.95, stiltHeight: 1.08, wallHeight: 1.42, ridgeHeight: 1.12, hasPorch: true, hasLadder: true, ladderSide: "left", hasChimney: true, isHero: true },
      { u: 0.770, v: 0.512, yaw: -0.52, width: 2.15, length: 2.6, stiltHeight: 0.92, wallHeight: 1.28, ridgeHeight: 0.98, hasPorch: true, hasLadder: false, hasPointLight: true },
      { u: 0.850, v: 0.468, yaw: -0.45, width: 2.4, length: 2.8, stiltHeight: 0.75, wallHeight: 1.35, ridgeHeight: 1.05, hasPorch: false, hasLadder: false },
      { u: 0.848, v: 0.422, yaw: -0.42, width: 1.75, length: 2.0, stiltHeight: 0.55, wallHeight: 1.05, ridgeHeight: 0.85, hasPorch: false, hasLadder: false },
      { u: 0.686, v: 0.474, yaw: -0.35, width: 1.85, length: 2.2, stiltHeight: 0.62, wallHeight: 1.15, ridgeHeight: 0.90, hasPorch: false, hasLadder: false, hasChimney: true },
      { u: 0.630, v: 0.506, yaw: -0.30, width: 1.7, length: 2.0, stiltHeight: 0.58, wallHeight: 1.08, ridgeHeight: 0.84, hasPorch: false, hasLadder: false },
      { u: 0.588, v: 0.562, yaw: -0.48, width: 2.1, length: 2.55, stiltHeight: 0.72, wallHeight: 1.22, ridgeHeight: 0.94, hasPorch: true, hasLadder: false },
    ];

    for (const h of nightHuts) {
      const p = solveTerrainAtUV(h.u, h.v, "dark", 0);
      group.add(
        buildMachangHut({
          ...h,
          pos: p,
          isDay: false,
          roofType: "thatch",
          smokeCollectors: smokeOrigins,
          nightLights,
        })
      );
    }

    group.add(
      buildTerrainFence(
        [
          [0.215, 0.768],
          [0.242, 0.778],
          [0.260, 0.785],
        ],
        "dark",
        bambooFenceMat
      )
    );

    const emberGeo = new THREE.PlaneGeometry(0.11, 0.11);
    const emberCount = isMobile ? 5 : 7;
    const hearthCoords = [[0.560, 0.604], [0.653, 0.536]];
    for (let hIdx = 0; hIdx < hearthCoords.length; hIdx++) {
      const [hu, hv] = hearthCoords[hIdx];
      const hp = solveTerrainAtUV(hu, hv, "dark", 0.02);
      group.add(buildStoneHearthRing(hp, stoneMat, charredWoodMat));
      smokeOrigins.push(hp.clone().add(new THREE.Vector3(0, 0.25, 0)));

      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 1.15),
        new THREE.MeshBasicMaterial({
          map: getSoftGlowTexture(),
          color: 0xff8c2b,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0.70,
        })
      );
      glow.position.copy(hp).add(new THREE.Vector3(0, 0.25, 0.2));
      group.add(glow);
      hearthGlows.push(glow);

      if (hIdx === 0) {
        const hLight = new THREE.PointLight(0xff8022, 2.2, 7.5, 1.75);
        hLight.position.copy(hp).add(new THREE.Vector3(0, 0.42, 0.2));
        group.add(hLight);
        nightLights.push({ light: hLight, base: 2.2, seed: hu * 11 });
      }

      for (let e = 0; e < emberCount; e++) {
        const sp = new THREE.Mesh(
          emberGeo,
          new THREE.MeshBasicMaterial({
            map: getSoftGlowTexture(),
            color: 0xffb347,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        );
        group.add(sp);
        embers.push({ mesh: sp, origin: hp, phase: e / emberCount, speed: 0.42 + (e % 3) * 0.09, seed: e * 1.6 });
      }
    }
  } else {
    // DAY MODE — 13 calibrated Thatch & Corrugated Tin Machang huts matching Day reference
    const dayHuts = [
      { u: 0.932, v: 0.752, yaw: -0.72, width: 2.75, length: 3.3, stiltHeight: 1.15, wallHeight: 1.55, ridgeHeight: 1.20, roofType: "thatch", hasPorch: true, hasLadder: true, ladderSide: "front", isHero: true },
      { u: 0.842, v: 0.774, yaw: -0.72, width: 1.55, length: 1.85, stiltHeight: 0.85, wallHeight: 1.18, ridgeHeight: 0.78, roofType: "thatch", hasPorch: false, hasLadder: false, isOpenShed: true, hasLaundry: true },
      { u: 0.594, v: 0.852, yaw: 0.62, width: 2.35, length: 2.85, stiltHeight: 1.05, wallHeight: 1.42, ridgeHeight: 1.08, roofType: "thatch", hasPorch: true, hasLadder: true, ladderSide: "front", isHero: true },
      { u: 0.556, v: 0.664, yaw: 0.56, width: 2.30, length: 2.75, stiltHeight: 1.02, wallHeight: 1.40, ridgeHeight: 0.96, roofType: "tin", hasPorch: true, hasLadder: true, ladderSide: "front", hasLaundry: true, isHero: true },
      { u: 0.390, v: 0.785, yaw: 0.64, width: 2.15, length: 2.6, stiltHeight: 0.88, wallHeight: 1.32, ridgeHeight: 0.90, roofType: "tin", hasPorch: false, hasLadder: false },
      { u: 0.460, v: 0.706, yaw: 0.52, width: 1.65, length: 1.95, stiltHeight: 0.68, wallHeight: 1.12, ridgeHeight: 0.85, roofType: "thatch", hasPorch: false, hasLadder: false },
      { u: 0.592, v: 0.576, yaw: 0.42, width: 2.05, length: 2.45, stiltHeight: 0.72, wallHeight: 1.24, ridgeHeight: 0.84, roofType: "tin", hasPorch: false, hasLadder: false },
      { u: 0.720, v: 0.555, yaw: -0.58, width: 2.40, length: 2.85, stiltHeight: 0.95, wallHeight: 1.36, ridgeHeight: 1.04, roofType: "thatch", hasPorch: true, hasLadder: true, ladderSide: "front", hasChimney: true, isHero: true },
      { u: 0.674, v: 0.506, yaw: -0.45, width: 1.90, length: 2.25, stiltHeight: 0.72, wallHeight: 1.18, ridgeHeight: 0.90, roofType: "thatch", hasPorch: false, hasLadder: false },
      { u: 0.758, v: 0.480, yaw: -0.48, width: 1.80, length: 2.1, stiltHeight: 0.66, wallHeight: 1.12, ridgeHeight: 0.86, roofType: "thatch", hasPorch: false, hasLadder: false },
      { u: 0.818, v: 0.438, yaw: -0.42, width: 1.68, length: 1.95, stiltHeight: 0.56, wallHeight: 1.06, ridgeHeight: 0.82, roofType: "thatch", hasPorch: false, hasLadder: false },
      { u: 0.892, v: 0.458, yaw: -0.60, width: 2.70, length: 3.15, stiltHeight: 0.88, wallHeight: 1.34, ridgeHeight: 0.94, roofType: "tin", hasPorch: true, hasLadder: true, ladderSide: "front", hasChimney: true },
      { u: 0.960, v: 0.408, yaw: -0.55, width: 1.60, length: 1.85, stiltHeight: 0.52, wallHeight: 1.02, ridgeHeight: 0.80, roofType: "thatch", hasPorch: false, hasLadder: false },
    ];

    for (const h of dayHuts) {
      const p = solveTerrainAtUV(h.u, h.v, "light", 0);
      group.add(
        buildMachangHut({
          ...h,
          pos: p,
          isDay: true,
          smokeCollectors: smokeOrigins,
          laundryTargets: laundryItems,
        })
      );
    }

    group.add(
      buildTerrainFence(
        [
          [0.592, 0.988],
          [0.642, 0.936],
          [0.688, 0.894],
          [0.720, 0.864],
        ],
        "light",
        bambooFenceMat
      )
    );
    group.add(
      buildTerrainFence(
        [
          [0.722, 0.656],
          [0.768, 0.682],
          [0.824, 0.706],
          [0.858, 0.668],
        ],
        "light",
        bambooFenceMat
      )
    );

    const dayFirePos = solveTerrainAtUV(0.852, 0.910, "light", 0.02);
    group.add(buildStoneHearthRing(dayFirePos, stoneMat, charredWoodMat));
    smokeOrigins.push(dayFirePos.clone().add(new THREE.Vector3(0, 0.25, 0)));
    const dayFireGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.85),
      new THREE.MeshBasicMaterial({
        map: getSoftGlowTexture(),
        color: 0xff9a34,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.55,
      })
    );
    dayFireGlow.position.copy(dayFirePos).add(new THREE.Vector3(0, 0.14, 0.08));
    group.add(dayFireGlow);
    hearthGlows.push(dayFireGlow);
  }

  const mistTex = getMistWispTexture();
  const smokeGeo = new THREE.PlaneGeometry(1.08, 0.80);
  const smokeCount = isMobile ? 14 : 18;
  for (const origin of smokeOrigins) {
    for (let i = 0; i < smokeCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: mistTex,
        color: isDay ? 0xf2f5f7 : 0xd2e0ea,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const sp = new THREE.Mesh(smokeGeo, mat);
      group.add(sp);
      smokeSprites.push({
        mesh: sp,
        origin,
        phase: i / smokeCount,
        speed: 0.14 + (i % 5) * 0.02,
        seed: i * 1.9 + origin.x,
      });
    }
  }

  return {
    group,
    update(dt, timeSec) {
      for (const nl of nightLights) {
        nl.light.intensity = nl.base * (0.90 + 0.10 * Math.sin(timeSec * 4.4 + nl.seed) + 0.05 * Math.cos(timeSec * 8.2));
      }
      for (const hg of hearthGlows) {
        const f = 0.84 + 0.16 * Math.sin(timeSec * 7.8) + 0.08 * Math.cos(timeSec * 13.5);
        hg.material.opacity = (isDay ? 0.50 : 0.70) * f;
        hg.scale.setScalar(0.92 + f * 0.14);
      }
      for (const e of embers) {
        e.phase = (e.phase + dt * e.speed) % 1;
        const life = e.phase;
        e.mesh.position.set(
          e.origin.x + Math.sin(timeSec * 3.5 + e.seed) * 0.22 * life,
          e.origin.y + 0.15 + life * 1.25,
          e.origin.z + 0.15
        );
        e.mesh.material.opacity = (1 - life) * 0.9;
        e.mesh.scale.setScalar(1.0 - life * 0.65);
      }
      for (const s of smokeSprites) {
        s.phase = (s.phase + dt * s.speed) % 1;
        const life = s.phase;
        s.mesh.position.set(
          s.origin.x + life * 1.15 + Math.sin(timeSec * 1.3 + s.seed + life * 3.0) * 0.28,
          s.origin.y + life * 4.1,
          s.origin.z + life * 0.24
        );
        const sc = 0.58 + life * 2.45;
        s.mesh.scale.set(sc, sc, 1);
        s.mesh.rotation.z = timeSec * 0.18 + life * 1.4;
        const fade = Math.min(1, life * 4.2) * Math.pow(1 - life, 1.25);
        s.mesh.material.opacity = fade * (isDay ? 0.54 : 0.64);
      }
      for (const l of laundryItems) {
        l.mesh.rotation.x = 0.08 + Math.sin(timeSec * 2.4 + l.seed) * 0.14;
        l.mesh.rotation.z = Math.cos(timeSec * 1.9 + l.seed) * 0.07;
      }
    },
    dispose() {
      group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    },
  };
}

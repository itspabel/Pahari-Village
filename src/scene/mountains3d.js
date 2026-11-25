/**
 * src/scene/mountains3d.js — High-Detail Ridged-Noise 3D Pahari Mountain Ranges,
 * Normal-Mapped Forest & Ravine Relief, Dense Ridge/Valley Canopy Bands,
 * Animated 3D Flapping Bird Flocks, Valley Mist & Dual Day/Night Sky Domes.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { solveTerrainAtUV, terrainHeightAt } from "./terrain3d.js";
import {
  getMistWispTexture,
  getBroadleafClusterTexture,
  getMountainDetailNormalMap,
  getCloudWispsTexture,
  getBirdWingTexture,
  getBirdTailTexture,
} from "./textures3d.js";

function smoothstepPeak(u, center, width, height) {
  const d = (u - center) / Math.max(0.01, width);
  return Math.exp(-d * d) * height;
}

/** Multi-octave ridged noise for sharp hill-tract mountain spines and branching gullies */
function ridgedFbm(x, z, seed = 1.0) {
  const n1 = 1.0 - Math.abs(Math.sin(x * 0.14 + z * 0.08 + seed));
  const n2 = 1.0 - Math.abs(Math.cos(x * 0.29 - z * 0.21 + seed * 1.7));
  const n3 = 1.0 - Math.abs(Math.sin(x * 0.61 + z * 0.43 - seed * 2.3));
  return n1 * 0.56 + n2 * 0.29 + n3 * 0.15;
}

/** Injects world-space forested canopy stippling & eroded ravine shading into mountain PBR shader */
function applyMountainForestShader(mat, isDay) {
  mat.customProgramCacheKey = () => `pahari_mtn_forest_${isDay ? "d" : "n"}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vMtnWorldPos;`
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vMtnWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vMtnWorldPos;
        float mHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float mNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mHash(i), mHash(i + vec2(1.0, 0.0)), f.x),
            mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // Layered tropical forest canopy stipple + branching ridge highlight/crevice contrast
        float canopyFine = mNoise(vMtnWorldPos.xy * 1.45);
        float canopyMacro = mNoise(vMtnWorldPos.xz * 0.42 + vec2(3.1, 1.7));
        float ravine = mNoise(vec2(vMtnWorldPos.x * 0.72 + vMtnWorldPos.y * 0.35, vMtnWorldPos.z * 0.25));
        float detailMul = mix(0.76, 1.24, canopyFine * 0.55 + canopyMacro * 0.45);
        detailMul *= mix(0.82, 1.12, ravine);
        diffuseColor.rgb *= detailMul;`
      );
  };
}

/** Builds a deeply sculpted 3D mountain spur range with sharp spine ridges & lateral ravines */
function buildSculptedRange({
  width,
  depthZ,
  baseY,
  crestHeightFn,
  customSpurFn,
  crestColor,
  slopeColor,
  ravineColor,
  mistColor,
  ridgeSeed = 1.0,
  normalMap,
  isDay,
  isMobile = false,
}) {
  const segX = isMobile ? 120 : 156;
  const segY = isMobile ? 22 : 28;
  const heightSpan = 34;
  const geo = new THREE.PlaneGeometry(width, heightSpan, segX, segY);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cTmp = new THREE.Color();

  const crestPositions = [];
  const slopeTreeAnchors = [];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const vNorm = (pos.getY(i) + heightSpan * 0.5) / heightSpan; // 0 = valley base, 1 = ridge crest
    const uNorm = x / width + 0.5;
    const baseCrest = crestHeightFn(uNorm, x);

    const spineDetail = (ridgedFbm(x * 0.85, 0, ridgeSeed) - 0.5) * 1.45;
    const crestY = baseCrest + spineDetail * (0.45 + vNorm * 0.55);

    let spurZ;
    let sunlitFace;
    let ravineDepth;

    if (customSpurFn) {
      const sp = customSpurFn(x, vNorm);
      spurZ = sp.spurZ;
      sunlitFace = sp.sunlitFace;
      ravineDepth = sp.ravineDepth;
    } else {
      const spurWave =
        Math.sin(x * 0.16 + ridgeSeed + (1 - vNorm) * 1.8) * 3.1 +
        Math.cos(x * 0.38 - ridgeSeed * 1.4 - (1 - vNorm) * 2.4) * 1.55 +
        (ridgedFbm(x * 1.1, vNorm * 8.0, ridgeSeed + 3.1) - 0.5) * 2.2;
      const lateralRib = (1.0 - Math.abs(Math.sin(x * 0.19 + ridgeSeed * 1.3 + (1 - vNorm) * 1.2))) * 3.2;
      spurZ = Math.pow(1 - vNorm, 1.15) * 14.0 + (spurWave + lateralRib) * (1 - vNorm * 0.18);
      sunlitFace = THREE.MathUtils.clamp(0.45 + 0.55 * Math.cos(x * 0.16 + ridgeSeed + (1 - vNorm) * 1.8), 0, 1);
      ravineDepth = THREE.MathUtils.clamp(1.0 - lateralRib / 3.2, 0, 1);
    }

    const y = baseY - 16 + vNorm * (16 + crestY);
    pos.setXYZ(i, x, y, depthZ + spurZ);

    if (Math.abs(vNorm - 1.0) < 0.001) {
      crestPositions.push(new THREE.Vector3(x, y, depthZ + spurZ));
    } else if (vNorm > (isDay ? 0.16 : 0.28) && vNorm < 0.95 && i % (isDay ? 3 : 6) === 0) {
      slopeTreeAnchors.push(new THREE.Vector3(x, y, depthZ + spurZ));
    }

    const valleyMist = Math.pow(1 - vNorm, 1.95);
    cTmp.copy(slopeColor).lerp(crestColor, sunlitFace * 0.78 + vNorm * 0.22);
    if (ravineColor) {
      cTmp.lerp(ravineColor, ravineDepth * 0.52 * (1 - vNorm * 0.35));
    }
    cTmp.lerp(mistColor, valleyMist * 0.80);

    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    normalMap,
    normalScale: new THREE.Vector2(isDay ? 0.95 : 0.75, isDay ? 0.95 : 0.75),
    roughness: 0.94,
    metalness: 0.0,
  });
  applyMountainForestShader(mat, isDay);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return { mesh, geo, mat, crestPositions, slopeTreeAnchors };
}

/** Instanced real botanical tree & shrub crowns densely blanketing mountain crests & flanks */
function buildMountainForestBand(points, isDay, tintHex, scaleBase, group, disposables, opts = {}) {
  if (!points.length) return;
  const leafTex = getBroadleafClusterTexture(isDay, opts.texVariant || 0);
  const crownGeo = new THREE.SphereGeometry(1.0, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.68);
  const crownMat = new THREE.MeshStandardMaterial({
    map: leafTex,
    color: tintHex,
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.88,
  });
  disposables.push(crownGeo, crownMat);

  const matrices = [];
  const colors = [];
  const baseCol = new THREE.Color(0xffffff);
  const warmLeaf = new THREE.Color(isDay ? 0xd2e592 : 0x9ab09a);
  const deepLeaf = new THREE.Color(isDay ? 0x628050 : 0x5c736b);
  const cTmp = new THREE.Color();

  const dummy = new THREE.Object3D();
  const isShrub = Boolean(opts.isShrub);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const rnd = Math.sin(i * 19.7 + p.x * 2.1) * 0.5 + 0.5;
    const rnd2 = Math.cos(i * 11.3 - p.y * 1.7) * 0.5 + 0.5;
    const sc = scaleBase * (0.72 + rnd * 0.98);
    dummy.position.set(p.x + (rnd - 0.5) * 1.05, p.y - (isShrub ? 0.20 : 0.12) * sc, p.z + 0.38 + (rnd2 - 0.5) * 0.4);
    dummy.rotation.set(0.18 * (rnd - 0.5), rnd * Math.PI * 2, 0.12 * (rnd2 - 0.5));
    dummy.scale.set(
      sc * (isShrub ? 1.48 : 1.28),
      sc * (isShrub ? 0.72 : 0.96 + rnd2 * 0.25),
      sc * (isShrub ? 1.32 : 1.15)
    );
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());

    cTmp.copy(baseCol).lerp(warmLeaf, rnd * 0.65).lerp(deepLeaf, rnd2 * 0.55);
    colors.push(cTmp.clone());
  }

  const inst = new THREE.InstancedMesh(crownGeo, crownMat, matrices.length);
  for (let idx = 0; idx < matrices.length; idx++) {
    inst.setMatrixAt(idx, matrices[idx]);
    inst.setColorAt(idx, colors[idx]);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);
}

/** Articulated 3D feathered birds with sculpted head/beak, fanned tail, and 2-segment shoulder+wrist wingbeat physics */
function buildFlockOfBirds(isDay, group, disposables) {
  const wingTex = getBirdWingTexture(isDay);
  const tailTex = getBirdTailTexture(isDay);

  const bodyMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
  });
  const wingMat = new THREE.MeshLambertMaterial({
    map: wingTex,
    alphaTest: 0.22,
    side: THREE.DoubleSide,
  });
  const tailMat = new THREE.MeshLambertMaterial({
    map: tailTex,
    alphaTest: 0.22,
    side: THREE.DoubleSide,
  });

  function withVertexColor(srcGeo, hex) {
    const g = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
    srcGeo.dispose();
    const count = g.attributes.position.count;
    const c = new THREE.Color(hex);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  }

  // Sculpted aerodynamic fuselage + neck/head + pointed beak merged into 1 vertex-colored geometry
  const rawTorsoGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.004, -0.22),
      new THREE.Vector2(0.022, -0.14),
      new THREE.Vector2(0.044, -0.04),
      new THREE.Vector2(0.050, 0.05),
      new THREE.Vector2(0.036, 0.14),
      new THREE.Vector2(0.022, 0.22),
      new THREE.Vector2(0.018, 0.27),
      new THREE.Vector2(0.024, 0.31),
      new THREE.Vector2(0.016, 0.345),
      new THREE.Vector2(0.003, 0.36),
    ],
    8
  );
  rawTorsoGeo.rotateX(Math.PI * 0.5);

  const rawCrownGeo = new THREE.SphereGeometry(0.025, 7, 5);
  rawCrownGeo.scale(0.95, 0.9, 1.15);
  rawCrownGeo.translate(0, 0.008, 0.31);

  const rawBeakGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.012, 0.0),
      new THREE.Vector2(0.007, 0.04),
      new THREE.Vector2(0.001, 0.085),
    ],
    6
  );
  rawBeakGeo.rotateX(Math.PI * 0.5);
  rawBeakGeo.translate(0, -0.004, 0.35);

  const torsoPart = withVertexColor(rawTorsoGeo, isDay ? 0xf7f3e8 : 0x26323c);
  const crownPart = withVertexColor(rawCrownGeo, isDay ? 0x273038 : 0x161f26);
  const beakPart = withVertexColor(rawBeakGeo, isDay ? 0xe59c24 : 0x3b4954);
  const bodyGeo = mergeGeometries([torsoPart, crownPart, beakPart], false);
  torsoPart.dispose();
  crownPart.dispose();
  beakPart.dispose();

  const tailGeo = new THREE.PlaneGeometry(0.24, 0.24, 2, 2);
  tailGeo.translate(0, -0.12, 0);
  tailGeo.rotateX(Math.PI * 0.5);

  // Two-segment articulated wing builder (inner secondary wing + outer slotted primary wingtip)
  function makeSegmentWing(side, width, depth, uStart, uEnd, camberH, sweepBack) {
    const geo = new THREE.PlaneGeometry(width, depth, 4, 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i); // -width/2 .. +width/2
      const py = pos.getY(i); // -depth/2 (trailing) .. +depth/2 (leading)
      const t = px / width + 0.5; // 0 = inner joint, 1 = outer edge
      const worldX = side * t * width;
      const chordTaper = 1.0 - t * (uStart > 0.3 ? 0.45 : 0.08);
      const localZ = py * chordTaper - t * sweepBack;
      const localY = Math.sin(t * Math.PI) * camberH + (py / depth + 0.5) * 0.015;
      pos.setXYZ(i, worldX, localY, localZ);
      uv.setX(i, THREE.MathUtils.lerp(uStart, uEnd, t));
    }
    geo.computeVertexNormals();
    return geo;
  }

  const innerLen = 0.27;
  const outerLen = 0.31;
  const lInnerGeo = makeSegmentWing(-1, innerLen, 0.22, 0.0, 0.50, 0.024, 0.02);
  const rInnerGeo = makeSegmentWing(1, innerLen, 0.22, 0.0, 0.50, 0.024, 0.02);
  const lOuterGeo = makeSegmentWing(-1, outerLen, 0.21, 0.50, 1.0, 0.022, 0.10);
  const rOuterGeo = makeSegmentWing(1, outerLen, 0.21, 0.50, 1.0, 0.022, 0.10);

  disposables.push(
    bodyMat, wingMat, tailMat,
    bodyGeo, tailGeo,
    lInnerGeo, rInnerGeo, lOuterGeo, rOuterGeo
  );

  const birds = [];
  const flockDefs = isDay
    ? [
        // High V-formation flock soaring smoothly across open azure sky
        { type: "skyline", x0: -26, y: 14.4, z: -17.5, vx: 3.7, span: 36, flapHz: 3.3, scale: 1.85, phase: 0.0 },
        { type: "skyline", x0: -28.5, y: 14.8, z: -19.0, vx: 3.7, span: 36, flapHz: 3.5, scale: 1.74, phase: 1.1 },
        { type: "skyline", x0: -28.8, y: 14.0, z: -16.2, vx: 3.7, span: 36, flapHz: 3.4, scale: 1.72, phase: 2.2 },
        { type: "skyline", x0: -31.0, y: 15.0, z: -20.4, vx: 3.7, span: 36, flapHz: 3.6, scale: 1.64, phase: 3.4 },
        // Second sunlit pair gliding right-to-left over upper right peaks
        { type: "skyline", x0: 24, y: 13.1, z: -20.5, vx: -3.2, span: 38, flapHz: 3.2, scale: 1.76, phase: 0.8 },
        { type: "skyline", x0: 26.6, y: 13.5, z: -21.8, vx: -3.2, span: 38, flapHz: 3.4, scale: 1.66, phase: 2.0 },
        // Mid-valley thermal soarers wheeling gracefully above waterfall mist & green ridges
        { type: "circle", cx: -3.5, cy: 11.4, cz: -14, rx: 11.5, rz: 4.8, speed: 0.42, flapHz: 3.6, scale: 1.58, phase: 0.3 },
        { type: "circle", cx: -1.8, cy: 11.9, cz: -15.4, rx: 11.0, rz: 4.5, speed: 0.42, flapHz: 3.8, scale: 1.50, phase: 1.7 },
      ]
    : [
        // Night sky swifts gliding across the moonlit indigo sky & Milky Way
        { type: "skyline", x0: -20, y: 13.6, z: -18, vx: 3.0, span: 36, flapHz: 3.1, scale: 1.52, phase: 0.4 },
        { type: "skyline", x0: -22.5, y: 14.0, z: -19.5, vx: 3.0, span: 36, flapHz: 3.3, scale: 1.44, phase: 1.6 },
        { type: "circle", cx: 2.0, cy: 11.6, cz: -18, rx: 9.5, rz: 4.4, speed: 0.34, flapHz: 3.0, scale: 1.40, phase: 2.3 },
        { type: "circle", cx: 3.8, cy: 12.1, cz: -19.5, rx: 9.0, rz: 4.2, speed: 0.34, flapHz: 3.2, scale: 1.32, phase: 3.7 },
      ];

  for (const fd of flockDefs) {
    const bird = new THREE.Group();
    bird.scale.setScalar(fd.scale);

    const bodyRoot = new THREE.Group();
    const torso = new THREE.Mesh(bodyGeo, bodyMat);

    const tail = new THREE.Mesh(tailGeo, tailMat);
    tail.position.set(0, 0.006, -0.18);
    tail.rotation.x = 0.08;

    // Articulated Left Wing (Shoulder -> Inner Wing -> Wrist -> Outer Primary Wing)
    const lInner = new THREE.Mesh(lInnerGeo, wingMat);
    lInner.position.set(-0.028, 0.015, 0.04);
    const lOuter = new THREE.Mesh(lOuterGeo, wingMat);
    lOuter.position.set(-innerLen, 0.0, -0.02);
    lInner.add(lOuter);

    // Articulated Right Wing (Shoulder -> Inner Wing -> Wrist -> Outer Primary Wing)
    const rInner = new THREE.Mesh(rInnerGeo, wingMat);
    rInner.position.set(0.028, 0.015, 0.04);
    const rOuter = new THREE.Mesh(rOuterGeo, wingMat);
    rOuter.position.set(innerLen, 0.0, -0.02);
    rInner.add(rOuter);

    bodyRoot.add(torso, tail, lInner, rInner);
    bird.add(bodyRoot);
    group.add(bird);
    birds.push({ bird, bodyRoot, tail, lInner, lOuter, rInner, rOuter, ...fd });
  }

  return {
    update(timeSec) {
      for (const b of birds) {
        let x, y, z, dx, dy, dz, bankAngle;
        if (b.type === "skyline") {
          const total = b.span * 2;
          const raw = b.x0 + timeSec * b.vx + b.span;
          const wrapped = ((raw % total) + total) % total;
          x = wrapped - b.span;
          y = b.y + Math.sin(timeSec * 0.78 + b.phase) * 0.55;
          z = b.z + Math.cos(timeSec * 0.50 + b.phase) * 1.1;
          dx = b.vx;
          dy = Math.cos(timeSec * 0.78 + b.phase) * 0.42;
          dz = -Math.sin(timeSec * 0.50 + b.phase) * 0.55;
          bankAngle = Math.sin(timeSec * 0.65 + b.phase) * 0.14;
        } else {
          const t = timeSec * b.speed + b.phase;
          x = b.cx + Math.cos(t) * b.rx;
          z = b.cz + Math.sin(t) * b.rz;
          y = b.cy + Math.sin(t * 2.0 + b.phase) * 0.72;
          dx = -Math.sin(t) * b.rx * b.speed;
          dy = Math.cos(t * 2.0 + b.phase) * 1.2 * b.speed;
          dz = Math.cos(t) * b.rz * b.speed;
          bankAngle = 0.26 + Math.sin(t) * 0.12;
        }

        b.bird.position.set(x, y, z);
        b.bird.lookAt(x + dx, y + dy * 0.45, z + dz);
        b.bird.rotateZ(bankAngle);

        // Intermittent natural flight cadence: 5–6 rhythmic beats followed by graceful soaring glide
        const glideCycle = Math.sin(timeSec * 0.75 + b.phase * 1.7);
        const flapWeight = smoothstep(-0.25, 0.35, glideCycle);
        const phi = timeSec * b.flapHz * Math.PI * 2.0 + b.phase * 2.4;

        // Asymmetric downstroke/upstroke + aeroelastic wrist lag (outer wing bends gracefully at wrist)
        const shoulderWave = Math.sin(phi) + 0.18 * Math.sin(phi * 2.0);
        const wristWave = Math.sin(phi - 0.95);
        const featherPitch = Math.cos(phi) * 0.20 * flapWeight;

        // When gliding, wings hold classic shallow M-arch gull dihedral (inner slightly up, outer relaxed down)
        const innerAngle = THREE.MathUtils.lerp(0.14, shoulderWave * 0.52, flapWeight);
        const outerAngle = THREE.MathUtils.lerp(-0.22, wristWave * 0.46 - 0.10, flapWeight);

        // Right wing rotates positive Z to lift up; Left wing rotates negative Z to lift up
        b.rInner.rotation.z = innerAngle;
        b.rOuter.rotation.z = outerAngle;
        b.rInner.rotation.x = featherPitch;
        b.rOuter.rotation.x = featherPitch * 0.65;

        b.lInner.rotation.z = -innerAngle;
        b.lOuter.rotation.z = -outerAngle;
        b.lInner.rotation.x = featherPitch;
        b.lOuter.rotation.x = featherPitch * 0.65;

        // Subtle aerodynamic body lift reaction opposite the downstroke + tail trim
        b.bodyRoot.position.y = -innerAngle * 0.055 * flapWeight;
        b.bodyRoot.rotation.x = -innerAngle * 0.08 * flapWeight;
        b.tail.rotation.x = 0.08 + (1.0 - flapWeight) * 0.10;
      }
    },
  };
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function createNightSkyDome(isMobile = false) {
  const geo = new THREE.SphereGeometry(270, isMobile ? 36 : 56, isMobile ? 24 : 36);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 41.3);
        return fract(p.x * p.y);
      }

      vec2 hash22(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < ${isMobile ? 3 : 4}; i++) {
          v += a * noise2(p);
          p *= 2.04;
          a *= 0.5;
        }
        return v;
      }

      vec3 starLayer(vec2 sphUv, float scale, float densityThresh, float twinkleTime) {
        vec2 g = sphUv * scale;
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        vec2 rnd2 = hash22(id);
        float rnd = rnd2.x;
        if (rnd < densityThresh) return vec3(0.0);

        vec2 jitter = (rnd2 - 0.5) * 0.58;
        vec2 d = f - jitter;
        float dist = length(d);

        float mag = (rnd - densityThresh) / (1.0 - densityThresh);
        float tw = 0.68 + 0.32 * sin(twinkleTime * (1.4 + rnd2.y * 3.8) + rnd * 91.0);
        float core = exp(-dist * dist * (52.0 - mag * 22.0));
        float halo = smoothstep(0.38, 0.02, dist) * (0.18 + 0.45 * mag);
        float spike = 0.0;
        if (mag > 0.82) {
          float sx = exp(-abs(d.y) * 28.0) * exp(-abs(d.x) * 6.5);
          float sy = exp(-abs(d.x) * 28.0) * exp(-abs(d.y) * 6.5);
          spike = (sx + sy) * (mag - 0.82) * 2.2;
        }

        vec3 sCol = mix(vec3(0.72, 0.86, 1.0), vec3(1.0, 0.96, 0.88), rnd2.y);
        if (rnd2.y > 0.78) sCol = mix(sCol, vec3(1.0, 0.80, 0.58), (rnd2.y - 0.78) * 3.2);
        return sCol * (core + halo + spike) * tw * (0.45 + 0.85 * mag);
      }

      void main() {
        vec3 dir = normalize(vDir);
        float elev = clamp(dir.y, -0.02, 1.0);

        // Deep velvety midnight indigo zenith -> cool twilight slate horizon mist
        vec3 zenith = vec3(0.009, 0.016, 0.042);
        vec3 midSky = vec3(0.036, 0.058, 0.102);
        vec3 horizon = vec3(0.155, 0.220, 0.275);
        vec3 col = mix(horizon, midSky, smoothstep(-0.01, 0.062, elev));
        col = mix(col, zenith, smoothstep(0.052, 0.140, elev));

        // Spherical sky coordinates for distortion-free Milky Way & starfield
        vec2 sph = vec2(atan(dir.x, -dir.z), asin(clamp(dir.y, -0.99, 0.99)));

        // Rich diagonal Milky Way sweeping across upper-center/right sky (skip FBM outside band)
        vec2 mwUv = vec2(sph.x * 1.45, (sph.y - 0.018) * 3.9);
        float bandCoord = mwUv.x * 0.76 - mwUv.y * 0.65 + 0.10;
        float horizonFade = smoothstep(0.008, 0.062, elev);
        float coreMask = exp(-bandCoord * bandCoord * 10.5) * horizonFade;
        float haloMask = exp(-bandCoord * bandCoord * 3.2) * horizonFade;

        if (haloMask > 0.008) {
          float dustTex = fbm(mwUv * 5.6 + vec2(1.4, 0.8));
          float fineDust = fbm(mwUv * 13.5 - vec2(2.3, 1.1));
          float riftNoise = fbm(vec2(bandCoord * 7.8 + mwUv.y * 2.6, mwUv.x * 5.2));
          float riftBand = exp(-pow(bandCoord + (riftNoise - 0.5) * 0.15, 2.0) * 62.0);

          vec3 outerCloud = vec3(0.24, 0.36, 0.58) * (0.35 + 0.75 * dustTex);
          vec3 innerCore = mix(vec3(0.76, 0.68, 0.58), vec3(0.96, 0.80, 0.58), dustTex) * (0.45 + 0.88 * dustTex * fineDust);
          vec3 nebulaTint = vec3(0.46, 0.30, 0.58) * smoothstep(0.46, 0.76, fineDust) * coreMask;

          col += outerCloud * haloMask * 0.54;
          col += innerCore * coreMask * (1.0 - riftBand * 0.80) * 0.78;
          col += nebulaTint * (1.0 - riftBand * 0.65) * 0.34;
        }

        // 2-tier spherical multi-magnitude pinpoint stars (clipped cleanly above misty horizon)
        float starVis = smoothstep(0.012, 0.052, elev);
        if (starVis > 0.001) {
          vec3 stars = vec3(0.0);
          stars += starLayer(sph, 160.0, 0.958, uTime) * 1.12;
          stars += starLayer(sph + vec2(1.7, 0.9), 305.0, 0.938 - coreMask * 0.065, uTime * 1.15) * 0.68;
          col += stars * starVis;
        }

        // Luminous Crescent Moon in upper-left sky with atmospheric silver-blue corona
        vec3 moonDir = normalize(vec3(-0.30, 0.092, -0.949));
        float moonDist = length(dir - moonDir);
        float moonRadius = 0.0155;
        float glowWide = exp(-moonDist * 14.0) * 0.22;
        float glowInner = exp(-moonDist * 42.0) * 0.42;
        col += vec3(0.46, 0.60, 0.80) * glowWide + vec3(0.78, 0.84, 0.92) * glowInner;

        if (moonDist < moonRadius * 1.25) {
          vec2 mLocal = (dir.xy - moonDir.xy) / moonRadius;
          float r2 = dot(mLocal, mLocal);
          if (r2 < 1.0) {
            float nz = sqrt(max(0.0, 1.0 - r2));
            vec3 mNorm = normalize(vec3(mLocal.x, mLocal.y, nz));
            vec3 sunLight = normalize(vec3(0.84, 0.34, 0.42));
            float phase = smoothstep(-0.08, 0.26, dot(mNorm, sunLight));
            float mare = fbm(mLocal * 4.2 + vec2(2.1, 0.7));
            vec3 albedo = mix(vec3(0.72, 0.74, 0.76), vec3(0.98, 0.96, 0.90), mare);
            float earthshine = 0.06;
            float limb = smoothstep(1.0, 0.86, sqrt(r2));
            col = mix(col, albedo * (earthshine + phase * 1.35), limb);
          }
        }

        // Occasional subtle shooting star gliding swiftly across the upper right sky
        float meteorCycle = mod(uTime + 2.5, 9.0);
        if (meteorCycle < 0.75) {
          float mp = meteorCycle / 0.75;
          vec2 mHead = mix(vec2(0.12, 0.125), vec2(0.32, 0.072), mp);
          vec2 mDir = normalize(vec2(0.20, -0.053));
          vec2 rel = sph - mHead;
          float along = dot(rel, mDir);
          float perp = length(rel - mDir * along);
          if (along < 0.0 && along > -0.048) {
            float fadeTail = (1.0 + along / 0.048) * sin(mp * 3.14159);
            float streak = exp(-perp * 850.0) * fadeTail;
            col += vec3(0.95, 0.92, 0.82) * streak * 1.45;
          }
        }

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, geo, mat };
}

function createDaySkyDome(isMobile = false) {
  const geo = new THREE.SphereGeometry(270, isMobile ? 36 : 56, isMobile ? 24 : 36);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        // Linear HDR sky colors calibrated directly for AgX tone mapper across visible elev [-0.02..0.141]
        float elev = clamp(vDir.y, -0.04, 1.0);
        vec3 horizon = vec3(0.58, 0.65, 0.70);
        vec3 midSky = vec3(0.135, 0.405, 0.765);
        vec3 zenith = vec3(0.048, 0.225, 0.625);

        vec3 col = mix(horizon, midSky, smoothstep(-0.015, 0.048, elev));
        col = mix(col, zenith, smoothstep(0.042, 0.132, elev));

        // Subtle warm golden morning sun glow near left-center horizon
        float sunGlow = exp(-length(vDir.xy - vec2(-0.34, 0.03)) * 3.6);
        col += vec3(0.24, 0.14, 0.03) * sunGlow * (1.0 - smoothstep(0.03, 0.13, elev) * 0.65);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, geo, mat };
}

/** Layered drifting volumetric sky clouds (megh) calibrated squarely inside visible sky frustum */
function buildSkyClouds(isDay, group, disposables) {
  const cloudTex = getCloudWispsTexture(isDay);
  const clouds = [];

  const specs = isDay
    ? [
        { x: -72, y: 24, z: -146, w: 54, h: 20, speed: 3.6, op: 0.94 },
        { x: -34, y: 27, z: -156, w: 62, h: 22, speed: 3.1, op: 0.92 },
        { x: 6, y: 23, z: -142, w: 56, h: 20, speed: 3.8, op: 0.95 },
        { x: 48, y: 25, z: -152, w: 60, h: 22, speed: 3.3, op: 0.92 },
        { x: 82, y: 21, z: -158, w: 50, h: 18, speed: 2.9, op: 0.88 },
        { x: -56, y: 16, z: -168, w: 58, h: 18, speed: 2.5, op: 0.84 },
        { x: -12, y: 17, z: -172, w: 64, h: 19, speed: 2.3, op: 0.82 },
        { x: 32, y: 16, z: -166, w: 60, h: 18, speed: 2.6, op: 0.85 },
        { x: 68, y: 15, z: -174, w: 54, h: 17, speed: 2.2, op: 0.80 },
      ]
    : [
        { x: -58, y: 22, z: -150, w: 52, h: 18, speed: 1.9, op: 0.34 },
        { x: -8, y: 26, z: -164, w: 62, h: 20, speed: 1.6, op: 0.28 },
        { x: 48, y: 23, z: -156, w: 56, h: 19, speed: 1.8, op: 0.32 },
        { x: 16, y: 17, z: -180, w: 66, h: 18, speed: 1.4, op: 0.25 },
      ];

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const mat = new THREE.MeshBasicMaterial({
      map: cloudTex,
      color: isDay ? 0xffffff : 0xaac0d6,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: s.op,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
    mesh.position.set(s.x, s.y, s.z);
    group.add(mesh);
    disposables.push(mesh.geometry, mat);
    clouds.push({
      mesh,
      baseX: s.x,
      baseY: s.y,
      baseOp: s.op,
      speed: s.speed,
      seed: i * 1.9,
      span: 132,
    });
  }

  return {
    update(timeSec) {
      for (const c of clouds) {
        const total = c.span * 2;
        const drift = (((c.baseX + timeSec * c.speed + c.span) % total) + total) % total - c.span;
        c.mesh.position.x = drift;
        c.mesh.position.y = c.baseY + Math.sin(timeSec * 0.48 + c.seed) * 0.75;
        const breathe = 1.0 + Math.sin(timeSec * 0.35 + c.seed) * 0.035;
        c.mesh.scale.set(breathe, 1.0 + Math.cos(timeSec * 0.42 + c.seed) * 0.03, 1.0);
        // Smooth edge alpha fade so clouds never pop when wrapping off-screen
        const edgeFade = smoothstep(c.span, c.span - 24, Math.abs(drift));
        c.mesh.material.opacity = c.baseOp * edgeFade;
      }
    },
  };
}

export function createMountainsAndSky(mode = "dark", opts = {}) {
  const isDay = mode === "light";
  const isMobile = Boolean(opts.isMobile);
  const group = new THREE.Group();
  const disposables = [];
  const mtnNormal = getMountainDetailNormalMap();

  const sky = isDay ? createDaySkyDome(isMobile) : createNightSkyDome(isMobile);
  group.add(sky.mesh);
  disposables.push(sky.geo, sky.mat);

  const layers = isDay
    ? [
        // 1. Far warm-ochre & misty pale-blue backdrop range
        {
          width: 320,
          depthZ: -172,
          baseY: 0.0,
          crestHeightFn: (u) =>
            1.4 +
            smoothstepPeak(u, 0.25, 0.14, 3.0) +
            smoothstepPeak(u, 0.64, 0.14, 11.8) +
            smoothstepPeak(u, 0.78, 0.14, 7.6) +
            Math.sin(u * 14.0) * 1.1,
          crestColor: new THREE.Color(0xcabca6),
          slopeColor: new THREE.Color(0xdad0be),
          ravineColor: new THREE.Color(0xb6a994),
          mistColor: new THREE.Color(0xf4ecda),
          ridgeSeed: 1.1,
        },
        // 2. Dramatic blue-slate mountain range sweeping across center-right (peaks at u=0.67, 0.77, 0.84)
        {
          width: 250,
          depthZ: -126,
          baseY: 0.0,
          crestHeightFn: (u) =>
            2.2 +
            smoothstepPeak(u, 0.44, 0.12, 4.4) +
            smoothstepPeak(u, 0.618, 0.095, 11.2) +
            smoothstepPeak(u, 0.688, 0.085, 8.2) +
            smoothstepPeak(u, 0.742, 0.10, 8.8) +
            Math.cos(u * 24.0) * 0.95,
          crestColor: new THREE.Color(0x527a8e),
          slopeColor: new THREE.Color(0x6e94a4),
          ravineColor: new THREE.Color(0x3a5b6e),
          mistColor: new THREE.Color(0xdde4da),
          ridgeSeed: 2.6,
          addFoothillTrees: true,
          treeColor: 0x4b745d,
          treeScale: 1.05,
        },
        // 3. Mid-valley misty sage-teal ridge
        {
          width: 200,
          depthZ: -90,
          baseY: -0.5,
          crestHeightFn: (u) =>
            1.6 +
            smoothstepPeak(u, 0.28, 0.13, 3.6) +
            smoothstepPeak(u, 0.541, 0.14, 2.5) +
            smoothstepPeak(u, 0.71, 0.14, 4.4) +
            Math.sin(u * 21.0) * 0.85,
          crestColor: new THREE.Color(0x5e8a69),
          slopeColor: new THREE.Color(0x7aa381),
          ravineColor: new THREE.Color(0x3f684e),
          mistColor: new THREE.Color(0xd7e1d0),
          ridgeSeed: 4.0,
          addCrestTrees: true,
          addFoothillTrees: true,
          treeColor: 0x4b7546,
          treeScale: 1.18,
        },
        // 4. Prominent sunlit olive-green front mountain (peak exactly at u=0.295, v=0.335 -> x=-20.6, y=5.8)
        {
          width: 152,
          depthZ: -58,
          baseY: -0.4,
          crestHeightFn: (u) =>
            0.2 +
            smoothstepPeak(u, 0.275, 0.075, 3.2) +
            smoothstepPeak(u, 0.364, 0.058, 6.2) +
            smoothstepPeak(u, 0.432, 0.055, 3.6) +
            Math.sin(u * 28.0) * 0.45,
          customSpurFn: (x, vNorm) => {
            // Central sharp spine protruding down toward camera from main peak x=-20.6
            const mainSpine = Math.exp(-Math.pow((x + 20.6 - (1 - vNorm) * 2.4) / 4.2, 2)) * 5.8;
            // Branching left ridge spur
            const leftSpur = Math.exp(-Math.pow((x + 31.5 + (1 - vNorm) * 4.5) / 4.8, 2)) * 4.2;
            // Branching right shoulder spur descending toward valley
            const rightSpur = Math.exp(-Math.pow((x + 10.2 - (1 - vNorm) * 5.0) / 3.8, 2)) * 3.8;
            // Fine secondary razor ribs + eroded V-gullies
            const fineRibs = (1.0 - Math.abs(Math.sin(x * 0.34 + (1 - vNorm) * 2.2))) * 2.1;
            const spurZ = Math.pow(1 - vNorm, 1.12) * 12.5 + (mainSpine + leftSpur + rightSpur + fineRibs) * (1 - vNorm * 0.12);

            // Sunlit golden-olive left-facing slopes vs shaded moss-emerald right-facing gullies
            const slopeSign =
              Math.sin((x + 20.6 - (1 - vNorm) * 2.4) * 0.48) * 0.55 +
              Math.cos(x * 0.34 + (1 - vNorm) * 2.2) * 0.45;
            const sunlitFace = THREE.MathUtils.clamp(0.50 - slopeSign * 0.50, 0, 1);
            const ridgeGlow = THREE.MathUtils.clamp((mainSpine + leftSpur + rightSpur) / 5.5, 0, 1);
            const ravineDepth = THREE.MathUtils.clamp(1.0 - fineRibs / 2.1, 0, 1) * (1 - ridgeGlow * 0.4);
            return { spurZ, sunlitFace: Math.max(sunlitFace, ridgeGlow * 0.65), ravineDepth };
          },
          crestColor: new THREE.Color(0xa6c752),
          slopeColor: new THREE.Color(0x639036),
          ravineColor: new THREE.Color(0x2f5724),
          mistColor: new THREE.Color(0xcfdba5),
          ridgeSeed: 5.3,
          addCrestTrees: true,
          addFoothillTrees: true,
          addDenseShrubs: true,
          treeColor: 0x4e7c2d,
          treeScale: 1.12,
        },
      ]
    : [
        // 1. Far pale sage-blue peaks (right center peak u=0.60 -> x=+21.9, y=11.9)
        {
          width: 310,
          depthZ: -168,
          baseY: 0.0,
          crestHeightFn: (u) =>
            4.5 +
            smoothstepPeak(u, 0.281, 0.14, 7.6) +
            smoothstepPeak(u, 0.571, 0.12, 7.4) +
            smoothstepPeak(u, 0.78, 0.14, 5.2) +
            Math.sin(u * 15.0) * 1.1,
          crestColor: new THREE.Color(0x5b7275),
          slopeColor: new THREE.Color(0x4b6268),
          ravineColor: new THREE.Color(0x3a4f56),
          mistColor: new THREE.Color(0x88999c),
          ridgeSeed: 1.3,
        },
        // 2. Mid-far slate-blue ridge (left peak u=0.19 -> x=-52.2, y=13.9)
        {
          width: 250,
          depthZ: -122,
          baseY: 0.0,
          crestHeightFn: (u) =>
            3.8 +
            smoothstepPeak(u, 0.291, 0.13, 9.8) +
            smoothstepPeak(u, 0.668, 0.15, 5.8) +
            Math.cos(u * 19.0) * 1.1,
          crestColor: new THREE.Color(0x354f57),
          slopeColor: new THREE.Color(0x2b424a),
          ravineColor: new THREE.Color(0x1f333b),
          mistColor: new THREE.Color(0x73888e),
          ridgeSeed: 2.7,
        },
        // 3. Prominent near-left dark forested ridge sloping down to misty central valley
        {
          width: 196,
          depthZ: -86,
          baseY: -1.5,
          crestHeightFn: (u) =>
            0.2 +
            smoothstepPeak(u, 0.354, 0.13, 11.4) +
            smoothstepPeak(u, 0.84, 0.14, 9.2) +
            Math.sin(u * 23.0) * 0.9,
          crestColor: new THREE.Color(0x1e3638),
          slopeColor: new THREE.Color(0x172b2d),
          ravineColor: new THREE.Color(0x102022),
          mistColor: new THREE.Color(0x63797f),
          ridgeSeed: 4.1,
          addCrestTrees: true,
          addFoothillTrees: true,
          treeColor: 0x172926,
          treeScale: 1.18,
        },
        // 4. Immediate dark mountain spur flanks framing left & right valley opening
        {
          width: 150,
          depthZ: -58,
          baseY: -2.0,
          crestHeightFn: (u) =>
            -0.5 +
            smoothstepPeak(u, 0.18, 0.14, 8.2) +
            smoothstepPeak(u, 0.85, 0.14, 8.6) +
            Math.cos(u * 26.0) * 0.75,
          crestColor: new THREE.Color(0x152823),
          slopeColor: new THREE.Color(0x101e1a),
          ravineColor: new THREE.Color(0x0b1512),
          mistColor: new THREE.Color(0x4f686e),
          ridgeSeed: 5.8,
          addCrestTrees: true,
          addFoothillTrees: true,
          treeColor: 0x13241f,
          treeScale: 1.12,
        },
      ];

  for (const cfg of layers) {
    const r = buildSculptedRange({ ...cfg, normalMap: mtnNormal, isDay, isMobile });
    group.add(r.mesh);
    disposables.push(r.geo, r.mat);
    if (cfg.addCrestTrees) {
      buildMountainForestBand(
        r.crestPositions.filter((_, idx) => (isDay ? idx % 1 === 0 : idx % 2 === 0)),
        isDay,
        cfg.treeColor,
        cfg.treeScale || 1.1,
        group,
        disposables,
        { texVariant: 0 }
      );
    }
    if (cfg.addFoothillTrees) {
      buildMountainForestBand(
        r.slopeTreeAnchors,
        isDay,
        cfg.treeColor,
        (cfg.treeScale || 1.1) * 1.15,
        group,
        disposables,
        { texVariant: 1 }
      );
    }
    if (cfg.addDenseShrubs) {
      buildMountainForestBand(
        r.slopeTreeAnchors.filter((_, idx) => idx % 2 === 1),
        isDay,
        0x5a8834,
        (cfg.treeScale || 1.1) * 1.38,
        group,
        disposables,
        { texVariant: 2, isShrub: true }
      );
    }
  }

  // Animated 3D Mountain Waterfall ("Jhorna") in Day mode
  const waterfall = isDay ? buildDayWaterfall(group, disposables) : null;

  // Drifting valley mist banks
  const mistTex = getMistWispTexture();
  const mists = [];
  const mistCount = isDay ? 8 : 11;
  for (let i = 0; i < mistCount; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: mistTex,
      color: isDay ? 0xfcf6e8 : 0xaac0ca,
      transparent: true,
      depthWrite: false,
      opacity: isDay ? 0.28 : i < 6 ? 0.38 : 0.24,
    });
    const w = isDay ? 26 + (i % 3) * 8 : 20 + (i % 3) * 7;
    const h = isDay ? 8.0 : 6.2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(
      isDay ? -22 + i * 8.5 : -14 + (i % 5) * 3.8,
      isDay ? 9.2 + (i % 3) * 2.2 : 4.2 + (i % 4) * 1.15,
      isDay ? -54 - (i % 3) * 24 : -22 - (i % 4) * 14
    );
    group.add(mesh);
    disposables.push(mesh.geometry, mat);
    mists.push({
      mesh,
      baseX: mesh.position.x,
      speed: 0.16 + (i % 4) * 0.05,
      amp: 2.0 + (i % 3) * 0.85,
      baseOp: mat.opacity,
      seed: i * 1.6,
    });
  }

  // Animated 3D flying birds gliding & flapping across mountains and valleys
  const flock = buildFlockOfBirds(isDay, group, disposables);
  // Drifting volumetric sky clouds (megh)
  const skyClouds = buildSkyClouds(isDay, group, disposables);

  return {
    group,
    update(timeSec) {
      if (sky.mat.uniforms?.uTime) sky.mat.uniforms.uTime.value = timeSec;
      if (waterfall) waterfall.update(timeSec);
      for (const m of mists) {
        m.mesh.position.x = m.baseX + Math.sin(timeSec * m.speed + m.seed) * m.amp;
        m.mesh.material.opacity = m.baseOp * (0.86 + 0.14 * Math.sin(timeSec * 0.35 + m.seed));
      }
      skyClouds.update(timeSec);
      flock.update(timeSec);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Multi-tier 3D Day Mountain Waterfall ("Jhorna") with mossy rock gorge, cascading water shader, plunge pool & rising mist */
function buildDayWaterfall(group, disposables) {
  const wfGroup = new THREE.Group();
  const pool = solveTerrainAtUV(0.355, 0.480, "light", 0);
  const topOrigin = new THREE.Vector3(pool.x - 1.35, pool.y + 4.35, pool.z - 5.1);
  const midLedge = new THREE.Vector3(pool.x - 0.65, pool.y + 2.25, pool.z - 2.55);

  // 1. Sculpted mossy cliff gorge & rock ledges anchored deep into hillside
  const rockGeo = new THREE.DodecahedronGeometry(1.0, 1);
  const rp = rockGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const y = rp.getY(i);
    const z = rp.getZ(i);
    const n = 1.0 + 0.16 * Math.sin(x * 3.1 + y * 2.4) + 0.12 * Math.cos(z * 2.8 - x * 1.9);
    rp.setXYZ(i, x * n, y * n * 0.92, z * n);
  }
  rockGeo.computeVertexNormals();

  const cliffMat = new THREE.MeshStandardMaterial({
    color: 0x4b584b,
    roughness: 0.88,
  });
  const wetCliffMat = new THREE.MeshStandardMaterial({
    color: 0x35433b,
    roughness: 0.44,
    metalness: 0.08,
  });
  disposables.push(rockGeo, cliffMat, wetCliffMat);

  // Main rocky escarpment boulders framing left bank, center backdrop, right bank & middle step
  const cliffBlocks = [
    // Left canyon wall
    [-2.1, 3.6, -5.0, 1.5, 2.3, 1.4, cliffMat],
    [-1.9, 1.8, -3.3, 1.6, 2.1, 1.5, cliffMat],
    [-1.7, 0.4, -1.6, 1.4, 1.3, 1.3, cliffMat],
    // Right canyon wall
    [0.65, 3.3, -4.7, 1.5, 2.1, 1.4, cliffMat],
    [0.85, 1.6, -2.9, 1.5, 1.9, 1.4, cliffMat],
    [1.15, 0.3, -1.2, 1.3, 1.2, 1.2, cliffMat],
    // Wet back-wall behind cascade + stepped middle rock shelf
    [-1.1, 3.0, -4.6, 1.55, 2.4, 1.2, wetCliffMat],
    [-0.65, 1.5, -2.9, 1.6, 1.6, 1.25, wetCliffMat],
    [-0.55, 0.25, -1.5, 1.3, 0.7, 1.0, wetCliffMat],
    // Plunge pool rim stones
    [-1.35, -0.08, 0.55, 0.85, 0.48, 0.72, wetCliffMat],
    [1.25, -0.06, 0.45, 0.88, 0.50, 0.75, wetCliffMat],
    [-0.95, -0.10, 1.25, 0.65, 0.40, 0.60, cliffMat],
  ];

  const dryMats = [];
  const wetMats = [];
  const rockDummy = new THREE.Object3D();
  for (let i = 0; i < cliffBlocks.length; i++) {
    const [ox, oy, oz, sx, sy, sz, mat] = cliffBlocks[i];
    rockDummy.position.set(pool.x + ox, pool.y + oy, pool.z + oz);
    rockDummy.scale.set(sx, sy, sz);
    rockDummy.rotation.set(i * 0.4, i * 1.1, (i % 3) * 0.25);
    rockDummy.updateMatrix();
    if (mat === wetCliffMat) wetMats.push(rockDummy.matrix.clone());
    else dryMats.push(rockDummy.matrix.clone());
  }
  for (const [mats, mat] of [[dryMats, cliffMat], [wetMats, wetCliffMat]]) {
    if (!mats.length) continue;
    const inst = new THREE.InstancedMesh(rockGeo, mat, mats.length);
    for (let j = 0; j < mats.length; j++) inst.setMatrixAt(j, mats[j]);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    wfGroup.add(inst);
  }

  // 2. Animated 2-tier cascading waterfall shader
  const waterfallMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
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
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        // Vertical falling flow streaks + cross-turbulence
        float fallSpeed = uTime * 2.6;
        float streak1 = vnoise(vec2(vUv.x * 16.0, vUv.y * 5.0 + fallSpeed));
        float streak2 = vnoise(vec2(vUv.x * 30.0 + 3.7, vUv.y * 9.0 + fallSpeed * 1.45));
        float foam = smoothstep(0.36, 0.84, streak1 * 0.6 + streak2 * 0.45);

        // Top lip surge & bottom frothy splash
        float topLip = smoothstep(0.78, 0.98, vUv.y);
        float bottomSplash = smoothstep(0.24, 0.0, vUv.y);
        float sideFade = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);

        vec3 deepWater = vec3(0.18, 0.56, 0.64);
        vec3 aquaWater = vec3(0.42, 0.78, 0.84);
        vec3 whiteFoam = vec3(0.95, 0.98, 1.0);

        vec3 col = mix(deepWater, aquaWater, streak1 * 0.75 + 0.15);
        col = mix(col, whiteFoam, clamp(foam * 0.82 + topLip * 0.65 + bottomSplash * 0.88, 0.0, 1.0));

        float alpha = sideFade * clamp(0.68 + foam * 0.32 + bottomSplash * 0.30, 0.0, 0.98);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  disposables.push(waterfallMat);

  function addCascadeSheet(pTop, pBot, wTop, wBot, bowZ) {
    const segX = 10;
    const segY = 14;
    const geo = new THREE.PlaneGeometry(1, 1, segX, segY);
    const pos = geo.attributes.position;
    const center = pTop.clone().lerp(pBot, 0.5);
    const span = pTop.distanceTo(pBot);
    const dir = pBot.clone().sub(pTop).normalize();

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i); // -0.5..0.5
      const ly = pos.getY(i); // -0.5..0.5 (+0.5 top, -0.5 bottom)
      const tDown = 0.5 - ly; // 0 top, 1 bottom
      const w = THREE.MathUtils.lerp(wTop, wBot, tDown);
      const p = pTop.clone().lerp(pBot, tDown);
      const archForward = Math.sin(tDown * Math.PI) * bowZ;
      pos.setXYZ(i, p.x + lx * w, p.y + archForward * 0.25, p.z + archForward);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, waterfallMat);
    wfGroup.add(mesh);
    disposables.push(geo);
    return { center, span, dir };
  }

  // Upper cascade from mountain cliff notch -> middle rock ledge
  addCascadeSheet(topOrigin, midLedge, 1.05, 1.38, 0.55);
  // Lower wider splayed cascade from middle rock ledge -> plunge pool
  addCascadeSheet(
    midLedge.clone().add(new THREE.Vector3(0.05, 0.12, 0.28)),
    pool.clone().add(new THREE.Vector3(0.0, -0.08, -0.18)),
    1.42,
    1.92,
    0.65
  );

  // 3. Turquoise plunge pool & expanding concentric white foam ripples
  const poolGeo = new THREE.CircleGeometry(1.75, 24);
  poolGeo.rotateX(-Math.PI * 0.5);
  const poolMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
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
      varying vec2 vUv;
      void main() {
        vec2 c = (vUv - 0.5) * 2.0;
        float r = length(c);
        float ring = sin(r * 22.0 - uTime * 4.4) * 0.5 + 0.5;
        float coreFoam = smoothstep(0.55, 0.05, r);
        float outerFade = smoothstep(1.0, 0.58, r);
        vec3 turquoise = vec3(0.16, 0.54, 0.58);
        vec3 foam = vec3(0.92, 0.97, 0.99);
        float foamAmt = clamp(coreFoam * 0.78 + pow(ring, 3.0) * 0.55 * (1.0 - r), 0.0, 1.0);
        vec3 col = mix(turquoise, foam, foamAmt);
        gl_FragColor = vec4(col, outerFade * 0.92);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.position.set(pool.x, terrainHeightAt(pool.x, pool.z, "light") + 0.06, pool.z + 0.15);
  poolMesh.scale.set(1.18, 1.0, 0.95);
  wfGroup.add(poolMesh);
  disposables.push(poolGeo, poolMat);

  // 4. Billowing waterfall spray & rising mist plumes
  const mistTex = getMistWispTexture();
  const sprays = [];
  const sprayCoords = [
    [pool.x - 0.1, pool.y + 0.65, pool.z + 0.15, 2.8, 1.6, 0.52],
    [pool.x + 0.4, pool.y + 0.85, pool.z + 0.35, 3.2, 1.8, 0.42],
    [midLedge.x, midLedge.y + 0.45, midLedge.z + 0.35, 2.2, 1.3, 0.40],
  ];
  for (let i = 0; i < sprayCoords.length; i++) {
    const [sx, sy, sz, sw, sh, op] = sprayCoords[i];
    const sMat = new THREE.MeshBasicMaterial({
      map: mistTex,
      color: 0xf4fafc,
      transparent: true,
      depthWrite: false,
      opacity: op,
    });
    const sGeo = new THREE.PlaneGeometry(sw, sh);
    const sm = new THREE.Mesh(sGeo, sMat);
    sm.position.set(sx, sy, sz);
    wfGroup.add(sm);
    disposables.push(sGeo, sMat);
    sprays.push({ mesh: sm, bx: sx, by: sy, baseOp: op, seed: i * 2.1 });
  }

  group.add(wfGroup);

  return {
    update(timeSec) {
      waterfallMat.uniforms.uTime.value = timeSec;
      poolMat.uniforms.uTime.value = timeSec;
      for (const sp of sprays) {
        sp.mesh.position.y = sp.by + ((timeSec * 0.35 + sp.seed) % 1.0) * 0.55;
        sp.mesh.position.x = sp.bx + Math.sin(timeSec * 0.9 + sp.seed) * 0.25;
        sp.mesh.material.opacity = sp.baseOp * (0.72 + 0.28 * Math.sin(timeSec * 1.6 + sp.seed));
      }
    },
  };
}

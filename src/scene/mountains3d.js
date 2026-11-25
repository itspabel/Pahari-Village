/**
 * src/scene/mountains3d.js — High-Detail Ridged-Noise 3D Pahari Mountain Ranges,
 * Normal-Mapped Forest & Ravine Relief, Dense Ridge/Valley Canopy Bands,
 * Animated 3D Flapping Bird Flocks, Valley Mist & Dual Day/Night Sky Domes.
 */

import * as THREE from "three";
import {
  getMistWispTexture,
  getBroadleafClusterTexture,
  getMountainDetailNormalMap,
  getCloudWispsTexture,
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
}) {
  const segX = 260;
  const segY = 48;
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
    } else if (vNorm > 0.28 && vNorm < 0.94 && i % 6 === 0) {
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

/** Instanced real botanical tree crowns densely blanketing mountain crests & flanks */
function buildMountainForestBand(points, isDay, tintHex, scaleBase, group, disposables) {
  if (!points.length) return;
  const leafTex = getBroadleafClusterTexture(isDay, 0);
  const crownGeo = new THREE.SphereGeometry(1.0, 9, 7, 0, Math.PI * 2, 0, Math.PI * 0.65);
  const crownMat = new THREE.MeshStandardMaterial({
    map: leafTex,
    color: tintHex,
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    roughness: 0.90,
  });
  disposables.push(crownGeo, crownMat);

  const matrices = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const rnd = Math.sin(i * 19.7 + p.x * 2.1) * 0.5 + 0.5;
    const sc = scaleBase * (0.75 + rnd * 0.95);
    dummy.position.set(p.x + (rnd - 0.5) * 0.9, p.y - 0.14 * sc, p.z + 0.35);
    dummy.rotation.set(0.15 * (rnd - 0.5), rnd * Math.PI * 2, 0);
    dummy.scale.set(sc * 1.32, sc * 0.92, sc * 1.15);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
  }

  const inst = new THREE.InstancedMesh(crownGeo, crownMat, matrices.length);
  matrices.forEach((m, idx) => inst.setMatrixAt(idx, m));
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);
}

/** Articulated 3D flapping mountain & valley birds (Day sunlit gulls/herons & Night dusk swifts) */
function buildFlockOfBirds(isDay, group, disposables) {
  const birdMat = new THREE.MeshStandardMaterial({
    color: isDay ? 0x2f3840 : 0x182128,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  const bellyMat = new THREE.MeshStandardMaterial({
    color: isDay ? 0xf2ede4 : 0x45525c,
    roughness: 0.75,
    side: THREE.DoubleSide,
  });

  // Tapered aerodynamic bird body + swept curved left/right wing geometries
  const bodyGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.005, -0.22),
      new THREE.Vector2(0.032, -0.05),
      new THREE.Vector2(0.038, 0.06),
      new THREE.Vector2(0.018, 0.18),
      new THREE.Vector2(0.004, 0.24),
    ],
    6
  );
  bodyGeo.rotateX(Math.PI * 0.5);

  const makeWingGeo = (side) => {
    const wg = new THREE.PlaneGeometry(0.46, 0.16, 4, 2);
    wg.translate(side * 0.23, 0, 0);
    const wp = wg.attributes.position;
    for (let i = 0; i < wp.count; i++) {
      const wx = Math.abs(wp.getX(i)) / 0.46; // 0=root, 1=tip
      // Taper chord width toward wingtip & sweep backward slightly
      wp.setZ(i, wp.getZ(i) * (1.0 - wx * 0.72) - wx * wx * 0.11);
      // Graceful gull-like camber
      wp.setY(i, Math.sin(wx * Math.PI) * 0.045);
    }
    wg.rotateX(-Math.PI * 0.5);
    wg.computeVertexNormals();
    return wg;
  };

  const leftWingGeo = makeWingGeo(-1);
  const rightWingGeo = makeWingGeo(1);
  disposables.push(birdMat, bellyMat, bodyGeo, leftWingGeo, rightWingGeo);

  const birds = [];
  const flockDefs = isDay
    ? [
        // Sweeping flock gliding across left-center morning valley & olive peak
        { cx: -8.5, cy: 11.4, cz: -28, rx: 6.5, rz: 4.5, speed: 0.28, flapHz: 3.8, scale: 1.05, phase: 0.0 },
        { cx: -6.8, cy: 11.9, cz: -29, rx: 6.2, rz: 4.2, speed: 0.28, flapHz: 4.1, scale: 0.96, phase: 0.6 },
        { cx: -5.4, cy: 11.1, cz: -31, rx: 6.8, rz: 4.6, speed: 0.28, flapHz: 3.9, scale: 0.90, phase: 1.2 },
        { cx: -10.2, cy: 12.2, cz: -26, rx: 6.0, rz: 4.0, speed: 0.28, flapHz: 4.2, scale: 0.92, phase: 1.8 },
        // Higher distant flock near right blue mountain peaks
        { cx: 9.5, cy: 14.5, cz: -46, rx: 8.5, rz: 5.5, speed: 0.22, flapHz: 3.4, scale: 1.22, phase: 2.3 },
        { cx: 11.2, cy: 15.1, cz: -48, rx: 8.2, rz: 5.2, speed: 0.22, flapHz: 3.6, scale: 1.15, phase: 2.9 },
        { cx: 12.6, cy: 14.7, cz: -50, rx: 8.8, rz: 5.6, speed: 0.22, flapHz: 3.5, scale: 1.10, phase: 3.5 },
        // Low soaring pair skimming above village ridge
        { cx: 1.8, cy: 8.2, cz: -14, rx: 4.6, rz: 3.2, speed: 0.36, flapHz: 4.4, scale: 0.85, phase: 4.1 },
        { cx: 3.1, cy: 8.6, cz: -15.5, rx: 4.4, rz: 3.0, speed: 0.36, flapHz: 4.6, scale: 0.80, phase: 4.7 },
      ]
    : [
        // Night mountain swifts & owls gliding gently above the moonlit valley mist
        { cx: -6.0, cy: 9.8, cz: -28, rx: 6.4, rz: 4.2, speed: 0.22, flapHz: 3.2, scale: 1.0, phase: 0.2 },
        { cx: -4.2, cy: 10.3, cz: -30, rx: 6.0, rz: 4.0, speed: 0.22, flapHz: 3.4, scale: 0.92, phase: 0.9 },
        { cx: 4.5, cy: 11.4, cz: -36, rx: 7.2, rz: 4.6, speed: 0.19, flapHz: 3.0, scale: 1.05, phase: 2.1 },
        { cx: 6.2, cy: 11.8, cz: -38, rx: 7.0, rz: 4.4, speed: 0.19, flapHz: 3.1, scale: 0.96, phase: 2.8 },
        { cx: -1.5, cy: 8.4, cz: -18, rx: 4.8, rz: 3.1, speed: 0.26, flapHz: 3.6, scale: 0.84, phase: 4.0 },
      ];

  for (const fd of flockDefs) {
    const bird = new THREE.Group();
    bird.scale.setScalar(fd.scale);
    const body = new THREE.Mesh(bodyGeo, bellyMat);
    const lWing = new THREE.Mesh(leftWingGeo, birdMat);
    const rWing = new THREE.Mesh(rightWingGeo, birdMat);
    bird.add(body, lWing, rWing);
    group.add(bird);
    birds.push({ bird, lWing, rWing, ...fd });
  }

  return {
    update(timeSec) {
      for (const b of birds) {
        const t = timeSec * b.speed + b.phase;
        const x = b.cx + Math.cos(t) * b.rx;
        const z = b.cz + Math.sin(t) * b.rz;
        const y = b.cy + Math.sin(t * 2.0 + b.phase) * 0.45;
        const dx = -Math.sin(t) * b.rx * b.speed;
        const dz = Math.cos(t) * b.rz * b.speed;

        b.bird.position.set(x, y, z);
        b.bird.lookAt(x + dx, y, z + dz);
        b.bird.rotateZ(Math.sin(t) * 0.16);

        // Intermittent glide & natural wingbeat cadence
        const glideMask = smoothstep(-0.3, 0.4, Math.sin(timeSec * 0.9 + b.phase * 1.7));
        const flap = Math.sin(timeSec * b.flapHz * Math.PI + b.phase * 3.1) * (0.18 + 0.44 * glideMask);
        b.lWing.rotation.z = -flap;
        b.rWing.rotation.z = flap;
      }
    },
  };
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function createNightSkyDome() {
  const geo = new THREE.SphereGeometry(270, 56, 36);
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
        for (int i = 0; i < 5; i++) {
          v += a * noise2(p);
          p *= 2.04;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        float elev = clamp(vDir.y, 0.0, 1.0);
        // Visible Night sky spans elev in [0.00..0.145]; calibrate gradient & Milky Way directly to it!
        vec3 zenith = vec3(0.020, 0.028, 0.056);
        vec3 midSky = vec3(0.068, 0.088, 0.132);
        vec3 horizon = vec3(0.30, 0.35, 0.39);
        vec3 col = mix(horizon, midSky, smoothstep(0.00, 0.065, elev));
        col = mix(col, zenith, smoothstep(0.055, 0.140, elev));

        // Prominent diagonal Milky Way sweeping across upper-center (vDir.x in -0.26..+0.26, elev 0.02..0.14)
        vec2 skyUv = vec2(vDir.x * 1.45, (elev - 0.02) * 3.8);
        float bandCoord = skyUv.x * 0.78 - skyUv.y * 0.62 + 0.14;
        float coreMask = exp(-bandCoord * bandCoord * 11.5) * smoothstep(0.005, 0.065, elev);
        float haloMask = exp(-bandCoord * bandCoord * 3.6) * smoothstep(0.005, 0.055, elev);

        float dustTex = fbm(skyUv * 5.8 + vec2(1.4, 0.8));
        float fineDust = fbm(skyUv * 12.5 - vec2(2.3, 1.1));
        // Dark Great Rift dust lane bisecting the bright galactic core
        float riftNoise = fbm(vec2(bandCoord * 8.0 + skyUv.y * 2.8, skyUv.x * 5.5));
        float riftBand = exp(-pow(bandCoord + (riftNoise - 0.5) * 0.14, 2.0) * 68.0);

        vec3 coreColor = vec3(0.84, 0.79, 0.72) * (0.48 + 0.85 * dustTex * fineDust);
        vec3 haloColor = vec3(0.38, 0.44, 0.54) * (0.40 + 0.70 * dustTex);
        col += haloColor * haloMask * 0.58;
        col += coreColor * coreMask * (1.0 - riftBand * 0.76) * 0.82;

        // Dense galactic micro-star cluster along the Milky Way core
        vec2 microGrid = vec2(vDir.x, elev) * 420.0;
        vec2 mId = floor(microGrid);
        vec2 mF = fract(microGrid) - 0.5;
        float mRnd = hash21(mId);
        if (mRnd > (0.972 - coreMask * 0.065) && elev > 0.025) {
          float mGlow = smoothstep(0.32, 0.04, length(mF));
          col += vec3(0.96, 0.94, 0.90) * mGlow * (0.35 + 0.65 * coreMask);
        }

        // Crisp twinkling bright stars across entire sky
        vec2 starGrid = vec2(vDir.x, elev) * 195.0;
        vec2 sid = floor(starGrid);
        vec2 sf = fract(starGrid) - 0.5;
        float rnd = hash21(sid);
        if (rnd > 0.968 && elev > 0.025) {
          float tw = 0.58 + 0.42 * sin(uTime * (1.7 + rnd * 3.6) + rnd * 71.0);
          float glow = smoothstep(0.24, 0.02, length(sf)) * tw;
          vec3 sCol = mix(vec3(0.86, 0.92, 1.0), vec3(1.0, 0.94, 0.84), fract(rnd * 37.0));
          col += sCol * glow * 0.95;
        }

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, geo, mat };
}

function createDaySkyDome() {
  const geo = new THREE.SphereGeometry(270, 56, 36);
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
        float elev = clamp(vDir.y, 0.0, 1.0);
        // Calibrated to visible sky elevation [0.00..0.145]: warm golden-ivory horizon -> soft morning cerulean blue
        vec3 horizon = vec3(0.992, 0.955, 0.855);
        vec3 midSky = vec3(0.840, 0.912, 0.952);
        vec3 zenith = vec3(0.540, 0.755, 0.915);
        vec3 col = mix(horizon, midSky, smoothstep(0.00, 0.075, elev));
        col = mix(col, zenith, smoothstep(0.060, 0.145, elev));

        float sunGlow = exp(-length(vDir.xy - vec2(-0.32, 0.05)) * 3.4);
        col += vec3(0.090, 0.058, 0.015) * sunGlow;

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
        { x: -64, y: 24, z: -148, w: 54, h: 20, speed: 0.42, op: 0.82 },
        { x: -12, y: 27, z: -162, w: 66, h: 24, speed: 0.34, op: 0.78 },
        { x: 46, y: 25, z: -154, w: 58, h: 22, speed: 0.38, op: 0.80 },
        { x: -38, y: 18, z: -178, w: 62, h: 19, speed: 0.28, op: 0.62 },
        { x: 22, y: 20, z: -182, w: 68, h: 21, speed: 0.26, op: 0.60 },
        { x: 76, y: 22, z: -160, w: 52, h: 20, speed: 0.36, op: 0.70 },
      ]
    : [
        { x: -58, y: 22, z: -150, w: 52, h: 18, speed: 0.28, op: 0.32 },
        { x: -8, y: 26, z: -164, w: 62, h: 20, speed: 0.22, op: 0.26 },
        { x: 48, y: 23, z: -156, w: 56, h: 19, speed: 0.25, op: 0.30 },
        { x: 16, y: 17, z: -180, w: 66, h: 18, speed: 0.19, op: 0.24 },
      ];

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const mat = new THREE.MeshBasicMaterial({
      map: cloudTex,
      color: isDay ? 0xfffaf0 : 0x9eb4c8,
      transparent: true,
      depthWrite: false,
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
      speed: s.speed,
      seed: i * 1.9,
      span: 145,
    });
  }

  return {
    update(timeSec) {
      for (const c of clouds) {
        const drift = ((c.baseX + timeSec * c.speed + c.span) % (c.span * 2)) - c.span;
        c.mesh.position.x = drift;
        c.mesh.position.y = c.baseY + Math.sin(timeSec * 0.22 + c.seed) * 0.55;
      }
    },
  };
}

export function createMountainsAndSky(mode = "dark") {
  const isDay = mode === "light";
  const group = new THREE.Group();
  const disposables = [];
  const mtnNormal = getMountainDetailNormalMap();

  const sky = isDay ? createDaySkyDome() : createNightSkyDome();
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
          crestColor: new THREE.Color(0x5f839c),
          slopeColor: new THREE.Color(0x7e9eb2),
          ravineColor: new THREE.Color(0x46687f),
          mistColor: new THREE.Color(0xe6e1d2),
          ridgeSeed: 2.6,
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
          crestColor: new THREE.Color(0x638c70),
          slopeColor: new THREE.Color(0x7fa488),
          ravineColor: new THREE.Color(0x456b54),
          mistColor: new THREE.Color(0xdbe2d5),
          ridgeSeed: 4.0,
          addFoothillTrees: true,
          treeColor: 0x4b7252,
          treeScale: 1.12,
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
          crestColor: new THREE.Color(0xb0cd58),
          slopeColor: new THREE.Color(0x6c963b),
          ravineColor: new THREE.Color(0x355c28),
          mistColor: new THREE.Color(0xd5dfad),
          ridgeSeed: 5.3,
          addFoothillTrees: true,
          treeColor: 0x4d772c,
          treeScale: 1.05,
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
    const r = buildSculptedRange({ ...cfg, normalMap: mtnNormal, isDay });
    group.add(r.mesh);
    disposables.push(r.geo, r.mat);
    if (cfg.addCrestTrees) {
      buildMountainForestBand(
        r.crestPositions.filter((_, idx) => idx % 2 === 0),
        isDay,
        cfg.treeColor,
        cfg.treeScale || 1.1,
        group,
        disposables
      );
    }
    if (cfg.addFoothillTrees) {
      buildMountainForestBand(
        r.slopeTreeAnchors,
        isDay,
        cfg.treeColor,
        (cfg.treeScale || 1.1) * 1.15,
        group,
        disposables
      );
    }
  }

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
      opacity: isDay ? 0.34 : i < 6 ? 0.38 : 0.24,
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

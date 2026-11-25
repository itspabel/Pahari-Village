/**
 * open_world_60fps.js — Elite CT Brain v2.7 Two-Tier Shadows, GPU Grass, Streaks & Grounded Spans Kit.
 *
 * Implements Pelican Campus Quest open-world (>25m) 60fps architecture:
 *  - Two-Tier Directional Shadow Split (`4096` static regional `autoUpdate = false` + `2048` tight dynamic hero).
 *  - Sun-Ray Extruded Shadow Culling so off-screen trees still cast ground shadows without popping.
 *  - Single-draw-call `InstancedMesh` GPU vertex-thinned grass (`0-28m` 100% -> `28-75m` smooth hash cull).
 *  - Anisotropic velocity-stretched ballistic spark / wind-draft streak pool (zero round dot sprites).
 *  - Grounded `u=0..1` terminal cable/bridge spans (`createTerminalCableSpan`).
 */

import * as THREE from "three";
import { ensureTelemetry, injectWorldCohesionHook, isSoftwareWebGL } from "./world_cohesion_agx.js";

export function createTwoTierShadowRig(scene, opts = {}) {
  const softwareCpu = opts.renderer ? isSoftwareWebGL(opts.renderer) : false;
  const staticRes = softwareCpu ? 1024 : (opts.staticMapSize ?? 4096);
  const heroRes = softwareCpu ? 1024 : (opts.heroMapSize ?? 2048);
  if (opts.renderer && softwareCpu) {
    opts.renderer.shadowMap.type = THREE.PCFShadowMap;
  }
  const sunDirection = (opts.sunDir ? opts.sunDir.clone() : new THREE.Vector3(0.55, 0.72, 0.42)).normalize();
  const staticSpan = opts.staticSpan ?? 64;
  const heroSpan = opts.heroSpan ?? 10.5;
  const resnapThreshold = opts.resnapThreshold ?? 8.0;

  // Hemisphere ambient sky/ground fill
  const hemiLight = new THREE.HemisphereLight(
    opts.skyColor ?? 0xdbeafe,
    opts.groundColor ?? 0x8b7355,
    opts.hemiIntensity ?? 0.62
  );
  scene.add(hemiLight);

  // Tier 1: Cached 4096x4096 Static Regional Sun Shadow (`autoUpdate = false`)
  const staticSun = new THREE.DirectionalLight(opts.sunColor ?? 0xfff3db, opts.staticIntensity ?? 1.15);
  staticSun.castShadow = true;
  staticSun.shadow.mapSize.set(staticRes, staticRes);
  staticSun.shadow.camera.near = 2;
  staticSun.shadow.camera.far = 260;
  staticSun.shadow.camera.left = -staticSpan;
  staticSun.shadow.camera.right = staticSpan;
  staticSun.shadow.camera.top = staticSpan;
  staticSun.shadow.camera.bottom = -staticSpan;
  staticSun.shadow.bias = -0.00035;
  staticSun.shadow.normalBias = 0.022;
  staticSun.shadow.autoUpdate = false;
  staticSun.shadow.needsUpdate = true;
  staticSun.position.copy(sunDirection).multiplyScalar(110);
  scene.add(staticSun);
  scene.add(staticSun.target);

  // Tier 2: Tight Dynamic Hero Shadow (`2048` on GPU / `1024` on SwiftShader CPU)
  const heroSun = new THREE.DirectionalLight(opts.sunColor ?? 0xfff5e0, opts.heroIntensity ?? 1.25);
  heroSun.castShadow = true;
  heroSun.shadow.mapSize.set(heroRes, heroRes);
  heroSun.shadow.camera.near = 1;
  heroSun.shadow.camera.far = 95;
  heroSun.shadow.camera.left = -heroSpan;
  heroSun.shadow.camera.right = heroSpan;
  heroSun.shadow.camera.top = heroSpan;
  heroSun.shadow.camera.bottom = -heroSpan;
  heroSun.shadow.bias = -0.00025;
  heroSun.shadow.normalBias = 0.015;
  if (opts.heroShadowAutoUpdate === false) {
    heroSun.shadow.autoUpdate = false;
    heroSun.shadow.needsUpdate = true;
  }
  heroSun.position.copy(sunDirection).multiplyScalar(42);
  scene.add(heroSun);
  scene.add(heroSun.target);

  const lastStaticAnchor = new THREE.Vector3(1e6, 1e6, 1e6);
  const tel = ensureTelemetry();
  tel.isOpenWorld = true;
  tel.staticShadowAutoUpdate = staticSun.shadow.autoUpdate;
  tel.heroShadowMapSize = heroRes;

  return {
    hemiLight,
    staticSun,
    heroSun,
    sunDirection,
    refreshStaticShadows() {
      staticSun.shadow.needsUpdate = true;
      tel.staticShadowAutoUpdate = staticSun.shadow.autoUpdate;
    },
    refreshAllShadows() {
      staticSun.shadow.needsUpdate = true;
      heroSun.shadow.needsUpdate = true;
      tel.staticShadowAutoUpdate = staticSun.shadow.autoUpdate;
    },
    updateHeroFocus(heroPos) {
      // Dynamic tight frustum tracks hero every frame
      heroSun.target.position.copy(heroPos);
      heroSun.target.updateMatrixWorld();
      heroSun.position.copy(heroPos).addScaledVector(sunDirection, 42);

      // Cached regional shadow re-bakes ONLY when hero travels > resnapThreshold meters
      if (heroPos.distanceToSquared(lastStaticAnchor) > resnapThreshold * resnapThreshold) {
        lastStaticAnchor.copy(heroPos);
        staticSun.target.position.set(Math.round(heroPos.x), 0, Math.round(heroPos.z));
        staticSun.target.updateMatrixWorld();
        staticSun.position.copy(staticSun.target.position).addScaledVector(sunDirection, 110);
        staticSun.shadow.needsUpdate = true;
      }
      tel.staticShadowAutoUpdate = staticSun.shadow.autoUpdate;
    },
  };
}

/**
 * Sun-Ray Extruded Shadow Culling: keeps off-screen trees/buildings casting shadows onto
 * the visible ground near `focusPos` without sudden shadow popping.
 */
export function applySunRayShadowCulling(casters, focusPos, sunDir, activeRadius = 56) {
  const maxSq = activeRadius * activeRadius;
  const invSunY = Math.abs(sunDir.y) > 0.12 ? 1.0 / sunDir.y : 8.0;
  for (let i = 0; i < casters.length; i++) {
    const obj = casters[i];
    if (!obj || !obj.position) continue;
    const h = Math.max(0, obj.position.y - focusPos.y + (obj.userData?.casterHeight || 8.0));
    const shadowTipX = obj.position.x - sunDir.x * h * invSunY;
    const shadowTipZ = obj.position.z - sunDir.z * h * invSunY;
    const dx0 = obj.position.x - focusPos.x;
    const dz0 = obj.position.z - focusPos.z;
    const dx1 = shadowTipX - focusPos.x;
    const dz1 = shadowTipZ - focusPos.z;
    const inRange = dx0 * dx0 + dz0 * dz0 <= maxSq || dx1 * dx1 + dz1 * dz1 <= maxSq;
    obj.castShadow = inRange;
  }
}

/**
 * Single-draw-call InstancedMesh grass field with GPU vertex-shader distance hash thinning
 * (100% blades 0-28m, smooth hash cull 28-75m, zero CPU mesh.count churn).
 */
export function createGpuGrassField({
  count = 9000,
  radius = 72,
  bladeHeight = 0.34,
  bladeWidth = 0.045,
  getTerrainHeight = () => 0,
  seed = 1337,
  renderer = null,
} = {}) {
  const softwareCpu = renderer ? isSoftwareWebGL(renderer) : Boolean(ensureTelemetry().isSoftwareRasterizer);
  const effectiveCount = softwareCpu ? Math.min(count, 900) : count;
  // Cambered 3-segment tapered grass blade
  const geo = new THREE.PlaneGeometry(bladeWidth, bladeHeight, 1, 3);
  geo.translate(0, bladeHeight * 0.5, 0);
  const posAttr = geo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const yNorm = posAttr.getY(i) / bladeHeight;
    posAttr.setX(i, posAttr.getX(i) * (1.0 - 0.78 * yNorm * yNorm));
    posAttr.setZ(i, yNorm * yNorm * bladeHeight * 0.22);
  }
  geo.computeVertexNormals();

  const uGrassTime = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({
    color: 0x5d8a3e,
    roughness: 0.76,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTime = uGrassTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uGrassTime;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 instWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float camDist = length(cameraPosition.xz - instWorld.xz);
          float instHash = fract(sin(dot(instWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);
          float keepProb = 1.0 - smoothstep(28.0, 75.0, camDist);
          if (instHash > keepProb) {
            transformed *= 0.0;
          } else {
            float hFrac = clamp(position.y / ${bladeHeight.toFixed(3)}, 0.0, 1.0);
            float breeze = sin(uGrassTime * 2.2 + instWorld.x * 0.35 + instWorld.z * 0.28) * 0.09 * hFrac * hFrac;
            transformed.x += breeze;
            transformed.z += breeze * 0.6;
          }
        #endif`
      );
  };
  injectWorldCohesionHook(mat);

  const mesh = new THREE.InstancedMesh(geo, mat, effectiveCount);
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < effectiveCount; i++) {
    const r = Math.sqrt(rand()) * radius;
    const ang = rand() * Math.PI * 2;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const y = getTerrainHeight(x, z);
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, (rand() - 0.5) * 0.16);
    const sc = 0.72 + rand() * 0.65;
    dummy.scale.set(sc, sc * (0.8 + rand() * 0.45), sc);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    color.setHSL(0.25 + (rand() - 0.5) * 0.05, 0.45 + rand() * 0.16, 0.32 + rand() * 0.14);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return {
    mesh,
    update(timeSec) {
      uGrassTime.value = timeSec;
    },
  };
}

/**
 * Velocity-stretched anisotropic ballistic spark / wind-draft ribbon pool (zero round polka-dot sprites).
 */
export function createAnisotropicStreakPool({ maxCount = 96, color = 0xffb347, baseLength = 0.18, speedScale = 0.045 } = {}) {
  const geo = new THREE.CylinderGeometry(0.006, 0.018, 1.0, 6, 1, false);
  geo.rotateX(Math.PI * 0.5);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 });
  const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
  mesh.frustumCulled = false;

  const items = Array.from({ length: maxCount }, () => ({
    active: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    life: 0,
    maxLife: 0.5,
    gravity: -9.81,
  }));

  const dummy = new THREE.Object3D();
  const lookTarget = new THREE.Vector3();
  const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < maxCount; i++) mesh.setMatrixAt(i, zeroMat);

  return {
    mesh,
    spawn(origin, velocity, { maxLife = 0.45, gravity = -9.81 } = {}) {
      const slot = items.find((it) => !it.active) || items[0];
      slot.active = true;
      slot.pos.copy(origin);
      slot.vel.copy(velocity);
      slot.life = 0;
      slot.maxLife = maxLife;
      slot.gravity = gravity;
    },
    update(dt, getGroundY = () => 0) {
      for (let i = 0; i < maxCount; i++) {
        const it = items[i];
        if (!it.active) {
          mesh.setMatrixAt(i, zeroMat);
          continue;
        }
        it.life += dt;
        if (it.life >= it.maxLife) {
          it.active = false;
          mesh.setMatrixAt(i, zeroMat);
          continue;
        }
        it.vel.y += it.gravity * dt;
        it.pos.addScaledVector(it.vel, dt);
        const gy = getGroundY(it.pos.x, it.pos.z);
        if (it.pos.y < gy + 0.015 && it.vel.y < 0) {
          it.pos.y = gy + 0.015;
          it.vel.y *= -0.42;
          it.vel.x *= 0.72;
          it.vel.z *= 0.72;
        }
        const speed = it.vel.length();
        const fade = 1.0 - it.life / it.maxLife;
        const streakLen = Math.max(0.05, (baseLength + speed * speedScale) * fade);

        dummy.position.copy(it.pos);
        if (speed > 1e-3) {
          lookTarget.copy(it.pos).add(it.vel);
          dummy.lookAt(lookTarget);
        }
        dummy.scale.set(fade, fade, streakLen);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/**
 * Builds a C² spline cable/railing span AND guarantees grounded vertical terminal posts
 * at u = 0.0 and u = 1.0 (Pelican Law 14: zero floating mid-air cable tips).
 */
export function createTerminalCableSpan({
  points,
  cableRadius = 0.025,
  postRadius = 0.055,
  getTerrainHeight = () => 0,
  cableMaterial,
  postMaterial,
} = {}) {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points);
  const cMat =
    cableMaterial ||
    injectWorldCohesionHook(new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.45, metalness: 0.75 }));
  const pMat =
    postMaterial ||
    injectWorldCohesionHook(new THREE.MeshStandardMaterial({ color: 0x4b525d, roughness: 0.52, metalness: 0.65 }));

  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, cableRadius, 10, false), cMat);
  tube.castShadow = true;
  group.add(tube);

  for (const u of [0.0, 1.0]) {
    const anchor = curve.getPointAt(u);
    const groundY = getTerrainHeight(anchor.x, anchor.z);
    const height = Math.max(0.25, anchor.y - groundY + 0.08);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(postRadius * 0.9, postRadius, height, 18), pMat);
    post.position.set(anchor.x, groundY + height * 0.5 - 0.04, anchor.z);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
  }
  return group;
}

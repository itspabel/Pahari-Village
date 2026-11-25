/**
 * src/scene/villageWorld3d.js — Pure 3D Static-Viewpoint Pahari Village (Night & Day)
 * - Strictly locked static viewpoint matching 1376:768 reference composition
 * - Genuine 3D terrain, mountains, Machang stilt houses, organic trees, bamboo, banana groves, water & mist
 * - Zero OrbitControls, zero camera movement, zero people/animals (architectural & landscape 3D stage first)
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { bus, state, DEMO_EVENTS } from "../contract.js";
import {
  ensureTelemetry,
  isSoftwareWebGL,
  updateWorldCohesionUniforms,
  createFusedAgXComposer,
} from "../kits/world_cohesion_agx.js";
import { createTwoTierShadowRig } from "../kits/open_world_60fps.js";
import {
  IMG_ASPECT,
  LOCKED_CAMERA_POS,
  LOCKED_CAMERA_TARGET,
  LOCKED_FOV_DEG,
  createTerrainForMode,
} from "./terrain3d.js";
import { createMountainsAndSky } from "./mountains3d.js";
import { createArchitectureForMode } from "./houses3d.js";
import { createFoliageForMode } from "./foliage3d.js";
import { getSoftGlowTexture } from "./textures3d.js";

function detectMobileDevice() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent || ""
  );
  const coarseMobile =
    Boolean(window.matchMedia?.("(pointer: coarse)")?.matches) &&
    Math.min(window.innerWidth || 9999, window.innerHeight || 9999) <= 920;
  return uaMobile || coarseMobile;
}

function createSubtleNightFireflies(group, isMobile = false) {
  const glowTex = getSoftGlowTexture();
  const flies = [];
  const count = isMobile ? 32 : 42;
  const sharedGeo = new THREE.PlaneGeometry(0.18, 0.18);
  const baseMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    color: 0xd9f578,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.75,
  });

  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(sharedGeo, baseMat.clone());
    const x = -18 + ((Math.sin(i * 17.3) * 0.5 + 0.5) * 36);
    const z = -12 + ((Math.cos(i * 11.7) * 0.5 + 0.5) * 24);
    const y = 1.4 + ((Math.sin(i * 23.1) * 0.5 + 0.5) * 4.5);
    m.position.set(x, y, z);
    group.add(m);
    flies.push({
      mesh: m,
      bx: x,
      by: y,
      bz: z,
      freq: 0.5 + (i % 6) * 0.12,
      seed: i * 1.93,
    });
  }

  return {
    update(timeSec) {
      for (const f of flies) {
        f.mesh.position.set(
          f.bx + Math.sin(timeSec * f.freq + f.seed) * 0.45,
          f.by + Math.cos(timeSec * f.freq * 1.3 + f.seed) * 0.30,
          f.bz + Math.sin(timeSec * 0.8 + f.seed) * 0.25
        );
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(timeSec * 2.1 + f.seed * 1.7), 2.4);
        f.mesh.material.opacity = 0.05 + pulse * 0.85;
        f.mesh.scale.setScalar(0.55 + pulse * 0.75);
      }
    },
    dispose() {
      sharedGeo.dispose();
      baseMat.dispose();
      for (const f of flies) f.mesh.material.dispose();
    },
  };
}

export function createVillageWorld(canvas) {
  ensureTelemetry();

  const softwareGl = (() => {
    try {
      const probe = document.createElement("canvas").getContext("webgl2");
      if (!probe) return true;
      const ext = probe.getExtension("WEBGL_debug_renderer_info");
      const name = String(
        ext ? probe.getParameter(ext.UNMASKED_RENDERER_WEBGL) : probe.getParameter(probe.RENDERER)
      );
      probe.getExtension("WEBGL_lose_context")?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(name);
    } catch (_) {
      return false;
    }
  })();

  const isMobile = detectMobileDevice();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !softwareGl,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(
    softwareGl ? 1 : Math.min(window.devicePixelRatio || 1, isMobile ? 1.15 : 1.25)
  );
  const initW = canvas.clientWidth || 1376;
  const initH = Math.max(1, canvas.clientHeight || 768);
  renderer.setSize(initW, initH, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = softwareGl || isMobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(state.theme === "light" ? 0xf5efe0 : 0x0b1016);
  scene.fog = new THREE.FogExp2(state.theme === "light" ? 0xebe3ce : 0x202d36, 0.0046);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.24;
  pmrem.dispose();

  // Strictly Locked Static Camera inside exact 1376:768 stage frame (ZERO OrbitControls)
  const camera = new THREE.PerspectiveCamera(LOCKED_FOV_DEG, IMG_ASPECT, 0.5, 420);
  camera.position.copy(LOCKED_CAMERA_POS);
  camera.lookAt(LOCKED_CAMERA_TARGET);

  const keyDir = new THREE.Vector3(-0.56, 0.58, 0.58).normalize();
  const shadowRig = createTwoTierShadowRig(scene, {
    renderer,
    sunDir: keyDir,
    sunColor: 0xa6c4e6,
    skyColor: 0x3b5670,
    groundColor: 0x162018,
    hemiIntensity: 0.72,
    staticIntensity: 0.82,
    heroIntensity: 0.90,
    staticSpan: 66,
    heroSpan: 30,
    staticMapSize: isMobile ? 1536 : 2048,
    heroMapSize: isMobile ? 1024 : 2048,
    heroShadowAutoUpdate: false,
  });
  shadowRig.updateHeroFocus(new THREE.Vector3(2.0, 2.5, 2.0));

  const nightGroup = new THREE.Group();
  const dayGroup = new THREE.Group();
  scene.add(nightGroup, dayGroup);

  const modeCache = {
    dark: null,
    light: null,
  };

  function ensureModeBuilt(modeKey) {
    if (modeCache[modeKey]) return modeCache[modeKey];
    const modeOpts = { isMobile };
    const terrain = createTerrainForMode(modeKey, modeOpts);
    const mountains = createMountainsAndSky(modeKey, modeOpts);
    const arch = createArchitectureForMode(modeKey, modeOpts);
    const foliage = createFoliageForMode(modeKey, modeOpts);
    const targetGroup = modeKey === "light" ? dayGroup : nightGroup;
    targetGroup.add(terrain.group, mountains.group, arch.group, foliage.group);
    const fireflies = modeKey === "dark" ? createSubtleNightFireflies(targetGroup, isMobile) : null;
    modeCache[modeKey] = { terrain, mountains, arch, foliage, fireflies };
    return modeCache[modeKey];
  }

  ensureModeBuilt(state.theme === "light" ? "light" : "dark");

  const composer = createFusedAgXComposer(renderer, scene, camera, {
    exposure: 1.16,
    ssaoStrength: 0.0,
    dofFocusDist: 42.0,
    dofFocusRange: 30.0,
    dofMaxBlurPx: 0.0,
    bloomStrength: 0.24,
    vignette: 0.14,
    grain: 0.006,
    disableDepthEffects: true,
    preservePixelRatio: true,
  });

  function applyThemeLighting(theme) {
    const isLight = theme === "light";
    const activeKey = isLight ? "light" : "dark";
    const wasMissing = !modeCache[activeKey];
    ensureModeBuilt(activeKey);

    nightGroup.visible = !isLight;
    dayGroup.visible = isLight;

    if (isLight) {
      scene.background.setHex(0x88b8e2);
      scene.fog.color.setHex(0xe8e4d8);
      scene.fog.density = 0.0021;
      scene.environmentIntensity = 0.36;

      if (shadowRig.hemiLight) {
        shadowRig.hemiLight.color.setHex(0xfbf5e6);
        shadowRig.hemiLight.groundColor.setHex(0x5b6c38);
        shadowRig.hemiLight.intensity = 1.08;
      }
      if (shadowRig.staticLight) {
        shadowRig.staticLight.color.setHex(0xfff0cc);
        shadowRig.staticLight.intensity = 1.52;
      }
      if (shadowRig.heroLight) {
        shadowRig.heroLight.color.setHex(0xfff0cc);
        shadowRig.heroLight.intensity = 1.52;
      }
      composer.setExposure(1.04);
      if (composer.agxPass) {
        composer.agxPass.uniforms.uBloomStrength.value = 0.05;
        composer.agxPass.uniforms.uVignette.value = 0.06;
        composer.agxPass.uniforms.uSsaoStrength.value = 0.0;
      }
      updateWorldCohesionUniforms({
        hazeColor: 0xe6e0d0,
        hazeDensity: 0.0010,
        warmBounceColor: 0xaa9660,
      });
    } else {
      scene.background.setHex(0x090e14);
      scene.fog.color.setHex(0x1f2d36);
      scene.fog.density = 0.0042;
      scene.environmentIntensity = 0.22;

      if (shadowRig.hemiLight) {
        shadowRig.hemiLight.color.setHex(0x4b6a88);
        shadowRig.hemiLight.groundColor.setHex(0x152017);
        shadowRig.hemiLight.intensity = 0.78;
      }
      if (shadowRig.staticLight) {
        shadowRig.staticLight.color.setHex(0xa3c4e8);
        shadowRig.staticLight.intensity = 0.78;
      }
      if (shadowRig.heroLight) {
        shadowRig.heroLight.color.setHex(0xa3c4e8);
        shadowRig.heroLight.intensity = 0.84;
      }
      composer.setExposure(1.18);
      if (composer.agxPass) {
        composer.agxPass.uniforms.uBloomStrength.value = 0.26;
        composer.agxPass.uniforms.uVignette.value = 0.14;
        composer.agxPass.uniforms.uSsaoStrength.value = 0.0;
      }
      updateWorldCohesionUniforms({
        hazeColor: 0x2c3c48,
        hazeDensity: 0.0018,
        warmBounceColor: 0x3b2d22,
      });
    }

    if (wasMissing && !softwareGl) {
      renderer.compile(scene, camera);
    }
    shadowRig.refreshAllShadows?.();
    renderer.shadowMap.needsUpdate = true;
  }

  applyThemeLighting(state.theme);
  const unsubTheme = bus.on(DEMO_EVENTS.THEME_TOGGLED, ({ theme }) => {
    applyThemeLighting(theme);
  });

  if (!softwareGl) {
    renderer.compile(scene, camera);
  }
  shadowRig.refreshAllShadows?.();
  renderer.shadowMap.needsUpdate = true;

  const handleResize = () => {
    const w = canvas.clientWidth || 1376;
    const h = Math.max(1, canvas.clientHeight || 768);
    camera.aspect = w / h;
    camera.fov = LOCKED_FOV_DEG;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  };
  window.addEventListener("resize", handleResize);

  let contextLost = false;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    contextLost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    renderer.shadowMap.needsUpdate = true;
  });

  return {
    ready: Promise.resolve(true),
    scene,
    camera,
    renderer,
    isContextLost: () => contextLost,
    getDiagnostics: () => ({
      isStaticLockedCamera: true,
      theme: state.theme,
      aspect: IMG_ASPECT,
      isMobile,
      isSoftwareWebGL: isSoftwareWebGL(renderer),
    }),
    update(dt, simTimeSec, realTimeSec) {
      if (contextLost) return;
      updateWorldCohesionUniforms({ time: realTimeSec });

      const activeKey = state.theme === "light" ? "light" : "dark";
      const activeMode = modeCache[activeKey];
      if (activeMode) {
        activeMode.terrain.update(simTimeSec);
        activeMode.mountains.update(simTimeSec);
        activeMode.arch.update(dt, simTimeSec);
        activeMode.foliage.update(simTimeSec);
        if (activeMode.fireflies) activeMode.fireflies.update(simTimeSec);
      }
      composer.render(realTimeSec);
    },
    renderOnly(realTimeSec = 0) {
      if (contextLost) return;
      composer.render(realTimeSec);
    },
    dispose() {
      unsubTheme();
      window.removeEventListener("resize", handleResize);
      for (const key of ["dark", "light"]) {
        const m = modeCache[key];
        if (!m) continue;
        m.terrain.dispose();
        m.mountains.dispose();
        m.arch.dispose();
        m.foliage.dispose();
        if (m.fireflies) m.fireflies.dispose();
      }
      envTex.dispose();
      renderer.dispose();
    },
  };
}

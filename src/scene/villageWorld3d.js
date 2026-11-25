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

function createSubtleNightFireflies(group) {
  const glowTex = getSoftGlowTexture();
  const flies = [];
  const mat = new THREE.MeshBasicMaterial({
    map: glowTex,
    color: 0xd9f578,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.75,
  });

  for (let i = 0; i < 42; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), mat.clone());
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

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !softwareGl,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(softwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  const initW = canvas.clientWidth || 1376;
  const initH = Math.max(1, canvas.clientHeight || 768);
  renderer.setSize(initW, initH, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = softwareGl ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

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
  });
  shadowRig.updateHeroFocus(new THREE.Vector3(2.0, 2.5, 2.0));

  const nightGroup = new THREE.Group();
  const dayGroup = new THREE.Group();
  scene.add(nightGroup, dayGroup);

  const nightTerrain = createTerrainForMode("dark");
  const nightMountains = createMountainsAndSky("dark");
  const nightArch = createArchitectureForMode("dark");
  const nightFoliage = createFoliageForMode("dark");
  nightGroup.add(nightTerrain.group, nightMountains.group, nightArch.group, nightFoliage.group);
  const nightFireflies = createSubtleNightFireflies(nightGroup);

  const dayTerrain = createTerrainForMode("light");
  const dayMountains = createMountainsAndSky("light");
  const dayArch = createArchitectureForMode("light");
  const dayFoliage = createFoliageForMode("light");
  dayGroup.add(dayTerrain.group, dayMountains.group, dayArch.group, dayFoliage.group);

  const composer = createFusedAgXComposer(renderer, scene, camera, {
    exposure: 1.16,
    ssaoStrength: softwareGl ? 0.0 : 0.26,
    dofFocusDist: 42.0,
    dofFocusRange: 30.0,
    dofMaxBlurPx: softwareGl ? 0.0 : 0.75,
    bloomStrength: 0.24,
    vignette: 0.14,
    grain: 0.006,
  });

  function applyThemeLighting(theme) {
    const isLight = theme === "light";
    nightGroup.visible = !isLight;
    dayGroup.visible = isLight;

    if (isLight) {
      scene.background.setHex(0xf8f1e1);
      scene.fog.color.setHex(0xf0e7d4);
      scene.fog.density = 0.0028;
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
        composer.agxPass.uniforms.uSsaoStrength.value = softwareGl ? 0.0 : 0.28;
      }
      updateWorldCohesionUniforms({
        hazeColor: 0xeee4cf,
        hazeDensity: 0.0012,
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
        composer.agxPass.uniforms.uSsaoStrength.value = softwareGl ? 0.0 : 0.24;
      }
      updateWorldCohesionUniforms({
        hazeColor: 0x2c3c48,
        hazeDensity: 0.0018,
        warmBounceColor: 0x3b2d22,
      });
    }
  }

  applyThemeLighting(state.theme);
  const unsubTheme = bus.on(DEMO_EVENTS.THEME_TOGGLED, ({ theme }) => {
    applyThemeLighting(theme);
  });

  if (!softwareGl) {
    renderer.compile(scene, camera);
  }

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
      isSoftwareWebGL: isSoftwareWebGL(renderer),
    }),
    update(dt, simTimeSec, realTimeSec) {
      if (contextLost) return;
      updateWorldCohesionUniforms({ time: realTimeSec });

      if (state.theme === "light") {
        dayTerrain.update(simTimeSec);
        dayMountains.update(simTimeSec);
        dayArch.update(dt, simTimeSec);
        dayFoliage.update(simTimeSec);
      } else {
        nightTerrain.update(simTimeSec);
        nightMountains.update(simTimeSec);
        nightArch.update(dt, simTimeSec);
        nightFoliage.update(simTimeSec);
        nightFireflies.update(simTimeSec);
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
      nightTerrain.dispose();
      nightMountains.dispose();
      nightArch.dispose();
      nightFoliage.dispose();
      dayTerrain.dispose();
      dayMountains.dispose();
      dayArch.dispose();
      dayFoliage.dispose();
      envTex.dispose();
      renderer.dispose();
    },
  };
}

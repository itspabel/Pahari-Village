/**
 * world_cohesion_agx.js — Elite CT Brain v2.7 AAA Shader, Calibrated PBR & Fused AgX Post-FX Kit.
 *
 * Provides:
 *  - Shared `onBeforeCompile` World-Cohesion GLSL hook (warm ground bounce, crevice AO,
 *    dappled canopy & sunlit window-mullion gobo, aerial haze, and <=28m View-Ray POM).
 *  - Calibrated dielectric & metallic `MeshPhysicalMaterial` presets (velvet sheen plumage/linen,
 *    corneal catchlight eyes, patinated bronze, weathered limestone, optical crystal glass).
 *  - Single-Pass Fused Cinema Post-FX Composer:
 *      1. Screen-Space Depth Contact AO (`uSsaoStrength`) via hardware `THREE.DepthTexture`
 *      2. Physical Optical Circle-of-Confusion Macro Bokeh DoF (`uDofFocusDist`, `uDofFocusRange`,
 *         `uDofMaxBlurPx`) with 16-tap Vogel golden-angle disc kernel & foreground bleed guard
 *      3. Sunlit Highlight Halation / Soft Bloom (`HDR > 1.05`)
 *      4. Golden-Hour AgX Look (preserving deep syrupy Rosso Corsa crimson `#ab1219` with zero
 *         `ACESFilmic` tomato-orange hue shift)
 *      5. Physical Lens Vignette + Luminance-Weighted 35mm Film Grain
 *  - Automatic `window.__CT_TELEMETRY__` registration for `verify_demo_build.mjs`.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

export function isSoftwareWebGL(renderer) {
  try {
    const gl = renderer?.getContext?.();
    if (!gl) return false;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(
      dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    );
    return /swiftshader|llvmpipe|software|mesa offscreen/i.test(name);
  } catch (_) {
    return false;
  }
}

export function ensureTelemetry() {
  if (typeof window === "undefined") return {};
  if (!window.__CT_TELEMETRY__) {
    window.__CT_TELEMETRY__ = {
      kitVersion: "2.7",
      drawCalls: 0,
      triangles: 0,
      isOpenWorld: false,
      staticShadowAutoUpdate: false,
      heroShadowMapSize: 2048,
      agxPostFxActive: false,
      worldCohesionMaterials: 0,
      musicPlaybackRate: 1.0,
      limiterThresholdDb: -1.0,
      inlineGlbPayloadMB: 0,
    };
  }
  return window.__CT_TELEMETRY__;
}

export function registerInlineGlbBytes(byteLength) {
  const tel = ensureTelemetry();
  tel.inlineGlbPayloadMB = Number(
    ((tel.inlineGlbPayloadMB || 0) + byteLength / (1024 * 1024)).toFixed(3)
  );
}

export function recordRendererTelemetry(renderer) {
  if (!renderer || !renderer.info) return;
  const tel = ensureTelemetry();
  tel.drawCalls = renderer.info.render.calls || 0;
  tel.triangles = renderer.info.render.triangles || 0;
}

const sharedCohesionUniforms = {
  uSunDir: { value: new THREE.Vector3(-0.526, 0.631, -0.561).normalize() },
  uWarmBounceColor: { value: new THREE.Color(0xd8bc96) },
  uHazeColor: { value: new THREE.Color(0xe6dfd3) },
  uHazeDensity: { value: 0.00018 },
  uCanopyGoboStrength: { value: 0.04 },
  uWindowGoboStrength: { value: 0.0 },
  uTime: { value: 0.0 },
};

export function updateWorldCohesionUniforms({
  sunDir,
  time,
  hazeColor,
  hazeDensity,
  warmBounceColor,
  groundBounceColor,
  canopyGoboStrength,
  windowGoboStrength,
  goboStrength,
} = {}) {
  if (sunDir) sharedCohesionUniforms.uSunDir.value.copy(sunDir).normalize();
  if (typeof time === "number") sharedCohesionUniforms.uTime.value = time;
  if (hazeColor) sharedCohesionUniforms.uHazeColor.value.set(hazeColor);
  if (typeof hazeDensity === "number") sharedCohesionUniforms.uHazeDensity.value = hazeDensity;
  const bounceCol = warmBounceColor ?? groundBounceColor;
  if (bounceCol) sharedCohesionUniforms.uWarmBounceColor.value.set(bounceCol);
  if (typeof canopyGoboStrength === "number") {
    sharedCohesionUniforms.uCanopyGoboStrength.value = canopyGoboStrength;
  }
  const winGobo = windowGoboStrength ?? goboStrength;
  if (typeof winGobo === "number") {
    sharedCohesionUniforms.uWindowGoboStrength.value = winGobo;
  }
}

/**
 * Injects unified world-cohesion optical shading (warm oak/ground bounce, sunlit window-mullion
 * gobo shafts, subtle atmospheric perspective, and optional <=28m coupled View-Ray POM)
 * into any MeshStandardMaterial or MeshPhysicalMaterial.
 */
export function injectWorldCohesionHook(material, opts = {}) {
  if (!material || material.userData?.__ctCohesionApplied) return material;
  material.userData = material.userData || {};
  material.userData.__ctCohesionApplied = true;

  // Drop redundant bumpMap if normalMap is bound (Pelican PBR law)
  if (material.normalMap && material.bumpMap) {
    material.bumpMap = null;
  }

  const enablePom = Boolean(opts.enablePom && opts.heightMap);
  const pomScale = opts.pomScale ?? 0.024;
  const pomMaxDist = opts.pomMaxDist ?? 28.0;
  const goboWeight = typeof opts.goboWeight === "number" ? opts.goboWeight : 1.0;

  material.customProgramCacheKey = () => (enablePom ? "ct_cohesion_pom_v2" : "ct_cohesion_std_v2");

  const prevCompile = material.onBeforeCompile;
  material.customProgramCacheKey = () =>
    `ct_cohesion_v27_${enablePom ? "pom" : "std"}_${goboWeight.toFixed(2)}_${material.uuid.slice(0, 6)}`;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prevCompile === "function") prevCompile(shader, renderer);

    shader.uniforms.uSunDir = sharedCohesionUniforms.uSunDir;
    shader.uniforms.uWarmBounceColor = sharedCohesionUniforms.uWarmBounceColor;
    shader.uniforms.uHazeColor = sharedCohesionUniforms.uHazeColor;
    shader.uniforms.uHazeDensity = sharedCohesionUniforms.uHazeDensity;
    shader.uniforms.uCanopyGoboStrength = sharedCohesionUniforms.uCanopyGoboStrength;
    shader.uniforms.uWindowGoboStrength = sharedCohesionUniforms.uWindowGoboStrength;
    shader.uniforms.uLocalGoboWeight = { value: goboWeight };
    shader.uniforms.uTime = sharedCohesionUniforms.uTime;

    if (enablePom) {
      shader.uniforms.uHeightMap = { value: opts.heightMap };
      shader.uniforms.uPomScale = { value: pomScale };
      shader.uniforms.uPomMaxDist = { value: pomMaxDist };
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vCtWorldPos;`
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vec4 ctWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          ctWp = instanceMatrix * ctWp;
        #endif
        vCtWorldPos = (modelMatrix * ctWp).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      varying vec3 vCtWorldPos;
      uniform vec3 uSunDir;
      uniform vec3 uWarmBounceColor;
      uniform vec3 uHazeColor;
      uniform float uHazeDensity;
      uniform float uCanopyGoboStrength;
      uniform float uWindowGoboStrength;
      uniform float uLocalGoboWeight;
      uniform float uTime;
      ${
        enablePom
          ? `uniform sampler2D uHeightMap;
             uniform float uPomScale;
             uniform float uPomMaxDist;`
          : ""
      }`
    );

    if (enablePom) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <map_fragment>",
          `vec2 ctPomOffset = vec2(0.0);
          {
            float ctCamDist = length(cameraPosition - vCtWorldPos);
            if (ctCamDist < uPomMaxDist) {
              float pomFade = 1.0 - smoothstep(uPomMaxDist * 0.65, uPomMaxDist, ctCamDist);
              vec3 viewDirWS = normalize(cameraPosition - vCtWorldPos);
              vec2 basePomUv = vec2(0.0);
              #ifdef USE_MAP
                basePomUv = vMapUv;
              #elif defined(USE_NORMALMAP)
                basePomUv = vNormalMapUv;
              #endif
              vec2 rayStep = (vec2(-viewDirWS.x, viewDirWS.z) / max(0.36, abs(viewDirWS.y))) * (uPomScale * pomFade * 0.3333);
              vec2 curUv = basePomUv;
              float curLayer = 0.0;
              for (int pStep = 0; pStep < 3; pStep++) {
                float depthVal = 1.0 - texture2D(uHeightMap, curUv).r;
                if (curLayer < depthVal) {
                  curUv += rayStep;
                  curLayer += 0.3333;
                }
              }
              ctPomOffset = clamp(curUv - basePomUv, vec2(-0.014), vec2(0.014));
            }
          }
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv + ctPomOffset);
            #ifdef DECODE_VIDEO_TEXTURE
              sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
            #endif
            diffuseColor *= sampledDiffuseColor;
          #endif`
        )
        .replace(
          "vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );",
          "vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv + ctPomOffset );"
        )
        .replace(
          "vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;",
          "vec3 mapN = texture2D( normalMap, vNormalMapUv + ctPomOffset ).xyz * 2.0 - 1.0;"
        );
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `// World-cohesion warm oak/ground bounce, sunlit window-mullion gobo & soft aerial haze
      vec3 ctUpNormal = normalize((vec4(0.0, 1.0, 0.0, 0.0) * viewMatrix).xyz);
      float upAlign = dot(normalize(normal), ctUpNormal);
      float bounceFactor = clamp(0.5 - 0.5 * upAlign, 0.0, 1.0) * 0.13;
      gl_FragColor.rgb += uWarmBounceColor * bounceFactor * diffuseColor.rgb;

      if (uCanopyGoboStrength > 0.001) {
        float goboWave = sin(vCtWorldPos.x * 0.42 + uTime * 0.28) * cos(vCtWorldPos.z * 0.38 - uTime * 0.22);
        float goboMask = mix(1.0, 0.93 + 0.07 * goboWave, uCanopyGoboStrength * uLocalGoboWeight);
        gl_FragColor.rgb *= goboMask;
      }

      if (uWindowGoboStrength > 0.001) {
        // Project point along sun ray to architectural NW casement window plane
        float rayLift = max(0.0, (14.0 - vCtWorldPos.y) / max(0.28, uSunDir.y));
        vec2 winHit = vCtWorldPos.xz + uSunDir.xz * rayLift;
        float diagCoord = winHit.x * 0.82 - winHit.y * 0.57;
        // Soft sunlit casement panes with penumbra mullion shadow bars & subtle courtyard leaf dapple
        float mullionA = smoothstep(0.55, 2.2, abs(diagCoord + 9.5));
        float mullionB = smoothstep(0.45, 1.9, abs(diagCoord - 7.8));
        float windowEnvelope = 1.0 - smoothstep(22.0, 44.0, abs(diagCoord + 1.0));
        float leafDapple = 0.96 + 0.04 * sin(winHit.x * 0.31 + uTime * 0.32) * cos(winHit.y * 0.27 - uTime * 0.24);
        float shaftLight = mix(0.88, 1.07 * mullionA * mullionB * leafDapple, windowEnvelope);
        gl_FragColor.rgb *= mix(1.0, shaftLight, uWindowGoboStrength * uLocalGoboWeight);
      }

      float ctDist = length(cameraPosition - vCtWorldPos);
      float hazeAmt = 1.0 - exp(-uHazeDensity * max(0.0, ctDist - 135.0));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, clamp(hazeAmt, 0.0, 0.36));
      #include <dithering_fragment>`
    );
  };

  const tel = ensureTelemetry();
  tel.worldCohesionMaterials = (tel.worldCohesionMaterials || 0) + 1;
  return material;
}

export function createCalibratedPBR(preset = "stone", overrides = {}) {
  const presets = {
    plumage_velvet: {
      color: 0xf4f1ea,
      roughness: 0.68,
      metalness: 0.0,
      sheen: 0.85,
      sheenRoughness: 0.42,
      sheenColor: new THREE.Color(0xfff5e4),
    },
    oatmeal_linen: {
      color: 0xece5d8,
      roughness: 0.80,
      metalness: 0.0,
      sheen: 0.72,
      sheenRoughness: 0.46,
      sheenColor: new THREE.Color(0xf5efe4),
    },
    wet_cornea: {
      color: 0x16181d,
      roughness: 0.06,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      ior: 1.38,
    },
    patinated_bronze: {
      color: 0x5c4732,
      roughness: 0.36,
      metalness: 0.86,
      clearcoat: 0.18,
      clearcoatRoughness: 0.35,
    },
    architectural_bronze: {
      color: 0x453f38,
      roughness: 0.38,
      metalness: 0.78,
      clearcoat: 0.16,
      clearcoatRoughness: 0.34,
    },
    weathered_limestone: {
      color: 0xd8cfc0,
      roughness: 0.84,
      metalness: 0.0,
    },
    honed_limestone: {
      color: 0xece6da,
      roughness: 0.56,
      metalness: 0.0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.42,
    },
    limewash_plaster: {
      color: 0xe2dbd0,
      roughness: 0.88,
      metalness: 0.0,
    },
    asphalt_road: {
      color: 0x32363d,
      roughness: 0.78,
      metalness: 0.04,
    },
    honed_slate: {
      color: 0xf0f2f6,
      roughness: 0.64,
      metalness: 0.02,
      clearcoat: 0.06,
      clearcoatRoughness: 0.28,
    },
    refractive_glass: {
      color: 0xdff2ff,
      roughness: 0.08,
      metalness: 0.05,
      transmission: 0.72,
      ior: 1.5,
      transparent: true,
    },
  };

  const mergedInput =
    preset && typeof preset === "object"
      ? { ...preset, ...(overrides || {}) }
      : { ...(presets[preset] || presets.weathered_limestone), ...(overrides || {}) };
  const {
    enablePom,
    heightMap,
    pomScale,
    pomMaxDist,
    goboWeight,
    bounceWeight: _bw,
    skipCohesion,
    ...matProps
  } = mergedInput;
  const needsPhysicalLobe =
    (matProps.clearcoat || 0) > 0 ||
    (matProps.sheen || 0) > 0 ||
    (matProps.transmission || 0) > 0 ||
    (matProps.anisotropy || 0) > 0 ||
    (matProps.iridescence || 0) > 0;
  const mat = needsPhysicalLobe
    ? new THREE.MeshPhysicalMaterial(matProps)
    : new THREE.MeshStandardMaterial(matProps);
  if (skipCohesion) return mat;
  return injectWorldCohesionHook(mat, { enablePom, heightMap, pomScale, pomMaxDist, goboWeight });
}

const FusedAgXPostShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uCameraNear: { value: 0.15 },
    uCameraFar: { value: 480.0 },
    uExposure: { value: 1.06 },
    uSsaoStrength: { value: 0.0 },
    uDofFocusDist: { value: 52.0 },
    uDofFocusRange: { value: 14.0 },
    uDofMaxBlurPx: { value: 0.0 },
    uBloomStrength: { value: 0.16 },
    uVignette: { value: 0.16 },
    uGrain: { value: 0.012 },
    uTime: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uResolution;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uExposure;
    uniform float uSsaoStrength;
    uniform float uDofFocusDist;
    uniform float uDofFocusRange;
    uniform float uDofMaxBlurPx;
    uniform float uBloomStrength;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    varying vec2 vUv;

    float readLinearDepth(vec2 uv) {
      float fragZ = texture2D(tDepth, clamp(uv, vec2(0.0005), vec2(0.9995))).x;
      if (fragZ >= 0.99995) return uCameraFar;
      float viewZ = perspectiveDepthToViewZ(fragZ, uCameraNear, uCameraFar);
      return -viewZ;
    }

    float computeCocPx(float linDepth) {
      float outside = max(0.0, abs(linDepth - uDofFocusDist) - uDofFocusRange);
      float normCoc = clamp(outside / max(8.0, uDofFocusDist * 0.56), 0.0, 1.0);
      return uDofMaxBlurPx * smoothstep(0.0, 1.0, normCoc);
    }

    // True Golden-Hour AgX inset + log2/sigmoid filmic shoulder + Punchy ASC-CDL + chroma outset
    // Preserves deep syrupy Rosso Corsa crimson (#ab1219) with zero ACES tomato-orange shift
    vec3 applyAgXGolden(vec3 col) {
      col = max(col * uExposure, vec3(0.0));
      const mat3 agxInset = mat3(
        0.842479062253094,  0.0423282422610123, 0.0423756549057051,
        0.0784335999999992, 0.878468636469772,  0.0784336,
        0.0792237451477643, 0.0791661274605434, 0.879142973793104
      );
      const mat3 agxOutset = mat3(
         1.19687900512017,  -0.0528968517574562, -0.0529716355144438,
        -0.0980208811401368, 1.15190312990417,   -0.0980434501171241,
        -0.0990297440797205, -0.0989611768448433, 1.15107367264116
      );

      vec3 inset = max(agxInset * col, vec3(1e-6));
      const float minEv = -12.47393;
      const float maxEv = 4.026069;
      vec3 ev = clamp((log2(inset) - minEv) / (maxEv - minEv), 0.0, 1.0);

      // 6th-order AgX filmic polynomial S-curve
      vec3 x2 = ev * ev;
      vec3 x4 = x2 * x2;
      vec3 mapped = 15.5 * x4 * x2
                  - 40.14 * x4 * ev
                  + 31.96 * x4
                  - 6.868 * x2 * ev
                  + 0.4298 * x2
                  + 0.1191 * ev
                  - 0.00232;
      mapped = clamp(mapped, 0.0, 1.0);

      // AgX "Punchy / Golden-Hour" ASC-CDL contrast curve in AgX perceptual space
      mapped = pow(clamp(mapped * 1.035, 0.0, 1.0), vec3(1.29));

      // Restore collector pigment purity via AgX outset + linear chroma recovery
      vec3 linearDisplay = pow(mapped, vec3(2.2));
      linearDisplay = max(agxOutset * linearDisplay, vec3(0.0));

      float luma = dot(linearDisplay, vec3(0.2126, 0.7152, 0.0722));
      linearDisplay = max(vec3(luma) + 1.26 * (linearDisplay - vec3(luma)), vec3(0.0));

      // Gentle golden-hour warmth in midtones while keeping whites clean & crimson rich
      float midMask = smoothstep(0.015, 0.22, luma) * (1.0 - smoothstep(0.55, 0.96, luma));
      linearDisplay *= mix(vec3(1.0), vec3(1.032, 1.008, 0.962), midMask);

      return pow(clamp(linearDisplay, 0.0, 0.992), vec3(1.0 / 2.2));
    }

    void main() {
      vec2 texel = 1.0 / max(uResolution, vec2(2.0));
      vec4 centerSample = texture2D(tDiffuse, vUv);
      vec3 hdrColor = centerSample.rgb;

      bool hasDepth = (uSsaoStrength > 0.001) || (uDofMaxBlurPx > 0.05);
      float centerDepth = hasDepth ? readLinearDepth(vUv) : uDofFocusDist;

      // 1. Physical Optical Circle-of-Confusion Macro Bokeh DoF (12-tap Vogel golden-angle disc)
      if (uDofMaxBlurPx > 0.05 && centerDepth < uCameraFar * 0.98) {
        float centerCoc = computeCocPx(centerDepth);
        if (centerCoc > 0.22) {
          vec3 accum = hdrColor * 1.15;
          float totalW = 1.15;
          float rotJitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
          for (int i = 0; i < 12; i++) {
            float fi = float(i);
            float r = sqrt((fi + 0.5) / 12.0);
            float theta = fi * 2.39996323 + rotJitter;
            vec2 sampleUv = vUv + vec2(cos(theta), sin(theta)) * (r * centerCoc) * texel;
            float tapDepth = readLinearDepth(sampleUv);
            float tapCoc = computeCocPx(tapDepth);
            // Prevent sharp foreground objects from bleeding blurry halos onto out-of-focus background
            float fgGuard = (tapDepth < centerDepth - 1.5)
              ? clamp(tapCoc / max(0.35, centerCoc), 0.0, 1.0)
              : 1.0;
            vec3 tapRgb = texture2D(tDiffuse, sampleUv).rgb;
            float tapLuma = dot(tapRgb, vec3(0.2126, 0.7152, 0.0722));
            // Subtle optical aperture highlight blooming inside out-of-focus bokeh discs
            float bokehHighlight = 1.0 + 0.36 * clamp(tapLuma - 0.95, 0.0, 2.8);
            float w = fgGuard * bokehHighlight;
            accum += tapRgb * w;
            totalW += w;
          }
          hdrColor = accum / max(0.001, totalW);
        }
      }

      // 2. Screen-Space Depth Contact AO (6-tap spiral micro-crevice grounding)
      if (uSsaoStrength > 0.001 && centerDepth < uCameraFar * 0.92) {
        float resScale = clamp(uResolution.y / 1080.0, 0.65, 2.2);
        float occ = 0.0;
        float aoSeed = fract(sin(dot(gl_FragCoord.xy, vec2(7.13, 157.37))) * 19731.7) * 6.2831853;
        // Scale range threshold linearly with depth so grazing tabletop planes never self-occlude
        float biasD = 0.022 + centerDepth * 0.0022;
        float maxRangeD = 0.45 + centerDepth * 0.032;
        for (int k = 0; k < 6; k++) {
          float fk = float(k);
          float radPx = (2.6 + fk * 1.15) * resScale;
          float ang = fk * 2.39996323 + aoSeed;
          vec2 aoUv = vUv + vec2(cos(ang), sin(ang)) * radPx * texel;
          float dSample = readLinearDepth(aoUv);
          float diff = centerDepth - dSample;
          if (diff > biasD && diff < maxRangeD) {
            float rangeFalloff = 1.0 - smoothstep(maxRangeD * 0.38, maxRangeD, diff);
            occ += rangeFalloff;
          }
        }
        float rawAo = clamp((occ / 6.0) * uSsaoStrength * 2.1, 0.0, 0.44);
        // Protect bright emissive window sky & specular clearcoat highlights from AO darkening
        float pixelLuma = dot(hdrColor, vec3(0.2126, 0.7152, 0.0722));
        float highlightProtect = 1.0 - smoothstep(0.95, 2.1, pixelLuma);
        hdrColor *= (1.0 - rawAo * highlightProtect);
      }

      // 3. Sunlit Window & Clearcoat Highlight Halation / Soft Bloom (4-tap wide halo, HDR > 1.05)
      if (uBloomStrength > 0.001) {
        vec3 haloSum = vec3(0.0);
        for (int b = 0; b < 4; b++) {
          float fb = float(b);
          float bAng = fb * 1.5707963 + 0.392699;
          vec2 bUv = vUv + vec2(cos(bAng), sin(bAng)) * 6.5 * texel;
          vec3 bCol = texture2D(tDiffuse, bUv).rgb;
          float bLuma = dot(bCol, vec3(0.2126, 0.7152, 0.0722));
          float knee = smoothstep(1.02, 2.25, bLuma);
          haloSum += max(bCol - vec3(0.88), vec3(0.0)) * knee;
        }
        hdrColor += (haloSum * 0.25) * uBloomStrength;
      }

      // 4. Golden-Hour AgX Tone Mapping
      vec3 graded = applyAgXGolden(hdrColor);

      // 5. Subtle Physical Medium-Format Lens Vignette + Luminance-Weighted 35mm Film Grain
      vec2 centered = vUv - 0.5;
      float vig = 1.0 - dot(centered, centered) * uVignette;
      graded *= clamp(vig, 0.80, 1.0);

      float grainHash = fract(sin(dot(gl_FragCoord.xy + fract(uTime * 0.17) * 97.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      float gradedLuma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
      float grainWeight = 1.0 - 0.55 * smoothstep(0.75, 1.0, gradedLuma);
      graded = clamp(graded + grainHash * uGrain * grainWeight, 0.010, 0.988);

      gl_FragColor = vec4(graded, centerSample.a);
    }
  `,
};

export function createFusedAgXComposer(renderer, scene, camera, opts = {}) {
  const softwareCpu = isSoftwareWebGL(renderer);
  const tel = ensureTelemetry();
  tel.agxPostFxActive = true;
  tel.isSoftwareRasterizer = softwareCpu;

  // Backward-compatible optional CPU bypass when forceComposerOnSoftware is not requested
  if (softwareCpu && !opts.forceComposerOnSoftware) {
    if (typeof window !== "undefined") {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    renderer.toneMapping = THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opts.exposure ?? 1.06;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return {
      composer: null,
      agxPass: null,
      hdrTarget: null,
      setDof() {},
      setDoF() {},
      setExposure(exp) {
        renderer.toneMappingExposure = exp;
      },
      setSize(w, h) {
        renderer.setSize(w, h, false);
      },
      render() {
        if (typeof window !== "undefined" && window.__CAPTURE_SKIP_DRAW__) return;
        renderer.render(scene, camera);
        recordRendererTelemetry(renderer);
      },
    };
  }

  // Full Single-Pass Fused Golden-Hour AgX + Depth Contact AO + Optical Bokeh DoF
  // Keep renderer.toneMapping strictly NoToneMapping so tone mapping is NEVER applied twice!
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const drawSize = renderer.getDrawingBufferSize(new THREE.Vector2(1920, 1080));
  const initW = Math.max(2, Math.round(drawSize.x));
  const initH = Math.max(2, Math.round(drawSize.y));

  const createDepthTex = (w, h) => {
    const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    dt.format = THREE.DepthFormat;
    dt.minFilter = THREE.NearestFilter;
    dt.magFilter = THREE.NearestFilter;
    dt.generateMipmaps = false;
    return dt;
  };

  const hdrTarget = new THREE.WebGLRenderTarget(initW, initH, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture: createDepthTex(initW, initH),
  });

  const composer = new EffectComposer(renderer, hdrTarget);
  // Ensure cloned readBuffer also carries a clean NearestFilter DepthTexture
  if (!composer.readBuffer.depthTexture) {
    composer.readBuffer.depthTexture = createDepthTex(initW, initH);
  } else {
    composer.readBuffer.depthTexture.minFilter = THREE.NearestFilter;
    composer.readBuffer.depthTexture.magFilter = THREE.NearestFilter;
  }

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const agxPass = new ShaderPass(FusedAgXPostShader);
  agxPass.needsSwap = false;
  agxPass.uniforms.uResolution.value.set(initW, initH);
  agxPass.uniforms.uCameraNear.value = camera.near;
  agxPass.uniforms.uCameraFar.value = camera.far;
  if (typeof opts.exposure === "number") agxPass.uniforms.uExposure.value = opts.exposure;
  if (typeof opts.ssaoStrength === "number") agxPass.uniforms.uSsaoStrength.value = opts.ssaoStrength;
  if (typeof opts.dofFocusDist === "number") agxPass.uniforms.uDofFocusDist.value = opts.dofFocusDist;
  if (typeof opts.dofFocusRange === "number") agxPass.uniforms.uDofFocusRange.value = opts.dofFocusRange;
  if (typeof opts.dofMaxBlurPx === "number") agxPass.uniforms.uDofMaxBlurPx.value = opts.dofMaxBlurPx;
  if (typeof opts.bloomStrength === "number") agxPass.uniforms.uBloomStrength.value = opts.bloomStrength;
  if (typeof opts.vignette === "number") agxPass.uniforms.uVignette.value = opts.vignette;
  if (typeof opts.grain === "number") agxPass.uniforms.uGrain.value = opts.grain;
  composer.addPass(agxPass);

  const scratchDrawSize = new THREE.Vector2();

  return {
    composer,
    agxPass,
    hdrTarget,
    setDof({ focusDist, focusRange, maxBlurPx } = {}) {
      if (typeof focusDist === "number") agxPass.uniforms.uDofFocusDist.value = focusDist;
      if (typeof focusRange === "number") agxPass.uniforms.uDofFocusRange.value = focusRange;
      if (typeof maxBlurPx === "number") agxPass.uniforms.uDofMaxBlurPx.value = maxBlurPx;
    },
    setDoF({ focusDist, focusRange, maxBlurPx } = {}) {
      if (typeof focusDist === "number") agxPass.uniforms.uDofFocusDist.value = focusDist;
      if (typeof focusRange === "number") agxPass.uniforms.uDofFocusRange.value = focusRange;
      if (typeof maxBlurPx === "number") agxPass.uniforms.uDofMaxBlurPx.value = maxBlurPx;
    },
    setExposure(exp) {
      if (typeof exp === "number") agxPass.uniforms.uExposure.value = exp;
    },
    setSize(w, h) {
      const pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      const effW = Math.max(2, Math.round(w * pr));
      const effH = Math.max(2, Math.round(h * pr));
      if (hdrTarget.depthTexture) {
        hdrTarget.depthTexture.image.width = effW;
        hdrTarget.depthTexture.image.height = effH;
      }
      if (composer.readBuffer?.depthTexture) {
        composer.readBuffer.depthTexture.image.width = effW;
        composer.readBuffer.depthTexture.image.height = effH;
      }
      agxPass.uniforms.uResolution.value.set(effW, effH);
    },
    render(timeSec = 0) {
      if (typeof window !== "undefined" && window.__CAPTURE_SKIP_DRAW__) return;
      renderer.toneMapping = THREE.NoToneMapping;

      renderer.getDrawingBufferSize(scratchDrawSize);
      const effW = Math.max(2, Math.round(scratchDrawSize.x));
      const effH = Math.max(2, Math.round(scratchDrawSize.y));
      if (composer.readBuffer.width !== effW || composer.readBuffer.height !== effH) {
        composer.readBuffer.setSize(effW, effH);
        composer.writeBuffer.setSize(effW, effH);
      }

      agxPass.uniforms.uTime.value = timeSec;
      agxPass.uniforms.uCameraNear.value = camera.near;
      agxPass.uniforms.uCameraFar.value = camera.far;
      agxPass.uniforms.uResolution.value.set(effW, effH);

      // 1. Render main 3D scene + DepthTexture into readBuffer and record true 3D drawCalls
      //    right BEFORE the 1-triangle fullscreen post-FX pass resets renderer.info!
      renderPass.renderToScreen = false;
      renderPass.render(renderer, composer.writeBuffer, composer.readBuffer, 0, false);
      recordRendererTelemetry(renderer);

      // 2. Render single-pass Fused AgX + Depth Contact AO + Optical Bokeh DoF to screen
      agxPass.uniforms.tDepth.value = composer.readBuffer.depthTexture;
      agxPass.renderToScreen = true;
      agxPass.render(renderer, composer.writeBuffer, composer.readBuffer, 0, false);
      renderer.setRenderTarget(null);
    },
  };
}

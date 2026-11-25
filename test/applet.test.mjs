import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  IMG_WIDTH,
  IMG_HEIGHT,
  IMG_ASPECT,
  LOCKED_CAMERA_POS,
  LOCKED_CAMERA_TARGET,
  LOCKED_FOV_DEG,
  terrainHeightAt,
  solveTerrainAtUV,
} from "../src/scene/terrain3d.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("exact 1376:768 stage frame, single Pahari Village view, Day/Night toggle, and static locked camera are enforced", () => {
  assert.equal(IMG_WIDTH, 1376);
  assert.equal(IMG_HEIGHT, 768);
  assert.ok(Math.abs(IMG_ASPECT - 1376 / 768) < 1e-6);
  assert.ok(LOCKED_CAMERA_POS.z > LOCKED_CAMERA_TARGET.z);
  assert.equal(LOCKED_FOV_DEG, 34.0);

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.ok(!html.includes('id="hero-stage-frame"'), "Hero horizon stage must be removed");
  assert.ok(!html.includes('id="hero-canvas"'), "Hero horizon canvas must be removed");
  assert.ok(html.includes('id="stage-frame"'));
  assert.ok(html.includes('id="stage-canvas"'));
  assert.ok(html.includes('id="btn-theme-light"'));
  assert.ok(html.includes('id="btn-theme-dark"'));

  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  assert.ok(css.includes("aspect-ratio: 1376 / 768"));

  const worldSrc = fs.readFileSync(path.join(ROOT, "src/scene/villageWorld3d.js"), "utf8");
  assert.ok(!/from\s+["'][^"']*OrbitControls|new\s+OrbitControls/.test(worldSrc), "OrbitControls must never be used");
  assert.ok(!fs.existsSync(path.join(ROOT, "src/scene/heroHorizon3d.js")), "heroHorizon3d.js must be removed");
  assert.ok(!fs.existsSync(path.join(ROOT, "src/scene/heroEnvironment3d.js")), "heroEnvironment3d.js must be removed");
  assert.ok(!fs.existsSync(path.join(ROOT, "src/scene/heroBoat3d.js")), "heroBoat3d.js must be removed");
});

test("3D architecture and foliage modules avoid cylindrical/cone/capsule primitives", () => {
  for (const rel of ["src/scene/houses3d.js", "src/scene/foliage3d.js"]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const banned of ["CylinderGeometry", "CapsuleGeometry", "ConeGeometry"]) {
      assert.ok(!src.includes(banned), `${rel} must not use ${banned}`);
    }
  }
});

test("3D terrain heightfield & camera ray solver place Night and Day landmarks accurately", () => {
  for (const mode of ["dark", "light"]) {
    const fgRight = solveTerrainAtUV(0.82, 0.85, mode);
    const midRight = solveTerrainAtUV(0.76, 0.64, mode);
    const upperRight = solveTerrainAtUV(0.75, 0.50, mode);

    assert.ok(Number.isFinite(fgRight.y) && Number.isFinite(midRight.y) && Number.isFinite(upperRight.y));
    assert.ok(fgRight.z > midRight.z, `${mode}: foreground z (${fgRight.z}) must be closer than mid (${midRight.z})`);
    assert.ok(midRight.z > upperRight.z, `${mode}: mid z (${midRight.z}) must be closer than upper (${upperRight.z})`);
    assert.ok(upperRight.y > terrainHeightAt(-10, -10, mode), `${mode}: right ridge should sit higher than left valley`);
  }
});

test("Pahari village retains birds/clouds/butterflies without audio and includes GitHub Pages deploy setup", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "src/audio.js")), "src/audio.js must be removed");
  const coreSrc = fs.readFileSync(path.join(ROOT, "src/core.js"), "utf8");
  assert.ok(!coreSrc.includes("PahariVillageAudio"), "core.js must not import audio");

  const mtnSrc = fs.readFileSync(path.join(ROOT, "src/scene/mountains3d.js"), "utf8");
  assert.ok(mtnSrc.includes("buildFlockOfBirds"), "mountains3d.js must include animated 3D birds");
  assert.ok(mtnSrc.includes("buildSkyClouds"), "mountains3d.js must include drifting sky clouds");
  assert.ok(mtnSrc.includes("getMountainDetailNormalMap"), "mountains3d.js must bind mountain normal relief");

  const folSrc = fs.readFileSync(path.join(ROOT, "src/scene/foliage3d.js"), "utf8");
  assert.ok(folSrc.includes("populateDenseHillsideCanopy"), "foliage3d.js must populate dense hillside canopy");
  assert.ok(folSrc.includes("buildButterfliesForMode"), "foliage3d.js must include animated 3D butterflies");
  assert.ok(folSrc.includes("USE_INSTANCING"), "foliage3d.js wind shader must sway instanced tree leaves");

  const viteCfg = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
  assert.ok(/base:\s*['"]\.\/['"]/.test(viteCfg), "vite.config.ts must configure relative base './' for GitHub Pages");
  assert.ok(fs.existsSync(path.join(ROOT, ".github/workflows/deploy.yml")), "GitHub Pages deploy workflow must exist");
  assert.ok(fs.existsSync(path.join(ROOT, "public/.nojekyll")), "public/.nojekyll must exist for GitHub Pages");
});

/**
 * src/main.js — Application Bootstrap & Frame Loop for Pahari Night Village
 */

import { VillageCore } from "./core.js";
import { initUI } from "./ui.js";
import { ensureTelemetry } from "./kits/world_cohesion_agx.js";

ensureTelemetry();

const FIXED_DT = 1 / 60;
let core = null;
let lastTime = 0;
let accumulator = 0;

async function init() {
  const canvas = document.getElementById("stage-canvas");
  if (!canvas) return;

  initUI();
  core = new VillageCore(canvas);

  const readyPromise = Promise.resolve(core.ready);
  window.__DEMO_READY__ = readyPromise;

  window.__advanceFrame = (dt = FIXED_DT) => {
    core.advanceFrame(dt);
  };

  await readyPromise;
  core.advanceFrame(FIXED_DT);

  let rafId = null;
  function rafLoop(now) {
    rafId = null;
    if (!core?.world?.isContextLost?.()) {
      if (!lastTime) lastTime = now;
      const frameDt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      accumulator += frameDt;
      let subSteps = 0;
      while (accumulator >= FIXED_DT && subSteps < 4) {
        core.advanceFrame(FIXED_DT);
        accumulator -= FIXED_DT;
        subSteps++;
      }
      if (subSteps === 0) {
        core.renderOnly();
      }
      rafId = requestAnimationFrame(rafLoop);
    }
  }

  canvas.addEventListener("webglcontextrestored", () => {
    if (rafId === null && !core?.world?.isContextLost?.()) {
      lastTime = 0;
      rafId = requestAnimationFrame(rafLoop);
    }
  });

  rafId = requestAnimationFrame(rafLoop);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

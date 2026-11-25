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
    if (document.hidden || core?.world?.isContextLost?.()) return;
    if (!lastTime) lastTime = now;
    const frameDt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;
    core.advanceFrame(frameDt);
    rafId = requestAnimationFrame(rafLoop);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastTime = 0;
    } else if (rafId === null && !core?.world?.isContextLost?.()) {
      lastTime = 0;
      rafId = requestAnimationFrame(rafLoop);
    }
  });

  canvas.addEventListener("webglcontextrestored", () => {
    if (rafId === null && !document.hidden && !core?.world?.isContextLost?.()) {
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

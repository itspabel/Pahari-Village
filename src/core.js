/**
 * src/core.js — Simulation Coordinator for Static-Viewpoint Dual-Mode Pahari Village
 */

import { createVillageWorld } from "./scene/villageWorld3d.js";
import { state } from "./contract.js";

export class VillageCore {
  constructor(canvas) {
    this.canvas = canvas;
    this.world = createVillageWorld(canvas);
    this.simTimeSec = 0;
    this.realTimeSec = 0;

    this.ready = Promise.resolve(this.world.ready).then(() => true);

    if (typeof window !== "undefined") {
      window.__getVillageDiagnostics = () => this.world.getDiagnostics();
    }
  }

  advanceFrame(dt = 1 / 60) {
    const safeDt = Math.min(0.1, Math.max(0, Number(dt) || 1 / 60));
    this.realTimeSec += safeDt;
    this.simTimeSec += safeDt;
    state.elapsedSec = this.simTimeSec;
    this.world.update(safeDt, this.simTimeSec, this.realTimeSec);
  }

  renderOnly() {
    this.world.renderOnly(this.realTimeSec);
  }

  dispose() {
    this.world.dispose();
  }
}

/**
 * src/contract.js — Shared Events & Theme State for Pahari Village 3D Scene
 */

export const DEMO_EVENTS = {
  THEME_TOGGLED: "village:theme_toggled",
};

export const state = {
  theme: "dark", // "dark" (Night) | "light" (Day)
  simSpeed: 1,
  elapsedSec: 0,
};

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this.listeners.get(event);
    if (set) set.delete(fn);
  }

  emit(event, payload = {}) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[Bus] Error in listener for "${event}":`, err);
      }
    }
  }
}

export const bus = new EventBus();

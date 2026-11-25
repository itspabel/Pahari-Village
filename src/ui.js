/**
 * src/ui.js — Minimal Light / Dark (Day / Night) Mode Toggle Only
 * Viewpoint and 3D world remain strictly static and non-controllable.
 */

import { bus, state, DEMO_EVENTS } from "./contract.js";

export function applyThemeUI(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  state.theme = normalized;

  if (typeof document !== "undefined") {
    const html = document.documentElement;
    html.classList.toggle("dark", normalized === "dark");
    html.classList.toggle("light", normalized === "light");
    if (document.body) {
      document.body.classList.toggle("theme-dark", normalized === "dark");
      document.body.classList.toggle("theme-light", normalized === "light");
    }

    const lightBtn = document.getElementById("btn-theme-light");
    const darkBtn = document.getElementById("btn-theme-dark");
    if (lightBtn && darkBtn) {
      const isLight = normalized === "light";
      lightBtn.classList.toggle("is-active", isLight);
      darkBtn.classList.toggle("is-active", !isLight);
      lightBtn.setAttribute("aria-pressed", String(isLight));
      darkBtn.setAttribute("aria-pressed", String(!isLight));
    }
  }

  bus.emit(DEMO_EVENTS.THEME_TOGGLED, { theme: normalized });
}

export function initUI() {
  const lightBtn = document.getElementById("btn-theme-light");
  const darkBtn = document.getElementById("btn-theme-dark");

  if (lightBtn) {
    lightBtn.addEventListener("click", () => applyThemeUI("light"));
  }
  if (darkBtn) {
    darkBtn.addEventListener("click", () => applyThemeUI("dark"));
  }

  if (typeof window !== "undefined") {
    window.__setTheme = (theme) => applyThemeUI(theme);
  }

  applyThemeUI(state.theme);
}

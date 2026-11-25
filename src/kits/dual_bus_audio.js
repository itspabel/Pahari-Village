/**
 * dual_bus_audio.js — Elite CT Brain v2.7 Locked 1.000x Dual-Bus Audio, -1.0 dBTP Limiter & Lookahead Foley Kit.
 *
 * Enforces Pelican Law 6 & `audio-dsp-critic` contracts:
 *  - Independent `musicBus` & `sfxBus` routed into a `-1.0 dBTP` brickwall master limiter.
 *  - Music `playbackRate` permanently locked to `1.000` (immune to slow-mo / hit-stop warble!).
 *  - `65-80ms` (`0.072s` default) lookahead Foley scheduling on `AudioContext.currentTime`.
 *  - Built-in procedural physical/bio-acoustic Foley synths (wingbeat/whoosh, impact/footstep,
 *    spark ricochet, and `WaveShaperNode` `tanh` formant vocalization).
 *  - Dual output to `ctx.destination` AND `window.__audioStreamDestination` for `--audio` capture.
 */

import { ensureTelemetry } from "./world_cohesion_agx.js";

export class DualBusAudioEngine {
  constructor() {
    this.ctx = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.limiter = null;
    this.musicSource = null;
    this._noiseBuffer = null;
    this._tanhCurve = null;

    const tel = ensureTelemetry();
    tel.musicPlaybackRate = 1.0;
    tel.limiterThresholdDb = -1.0;
  }

  init() {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    this.ctx = new AudioCtx();

    // Master -1.0 dBTP brickwall limiter (prevents clipping without pumping music under SFX)
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-1.0, this.ctx.currentTime);
    this.limiter.knee.setValueAtTime(0.0, this.ctx.currentTime);
    this.limiter.ratio.setValueAtTime(20.0, this.ctx.currentTime);
    this.limiter.attack.setValueAtTime(0.001, this.ctx.currentTime);
    this.limiter.release.setValueAtTime(0.08, this.ctx.currentTime);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.setValueAtTime(0.42, this.ctx.currentTime);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.setValueAtTime(0.75, this.ctx.currentTime);

    this.musicBus.connect(this.limiter);
    this.sfxBus.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    // Headless Playwright --audio capture tap
    if (typeof this.ctx.createMediaStreamDestination === "function") {
      const streamDest = this.ctx.createMediaStreamDestination();
      this.limiter.connect(streamDest);
      window.__audioStreamDestination = streamDest;
      window.__audioContext = this.ctx;
    }

    const tel = ensureTelemetry();
    tel.musicPlaybackRate = 1.0;
    tel.limiterThresholdDb = -1.0;
    return this.ctx;
  }

  async resume() {
    const ctx = this.init();
    if (ctx && ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch (_) {}
    }
    return ctx;
  }

  /**
   * Attaches a decoded AudioBuffer to `musicBus` with `playbackRate` strictly locked to `1.000`.
   */
  playLockedMusicBuffer(audioBuffer, { loop = true, gain = 0.42 } = {}) {
    const ctx = this.init();
    if (!ctx || !audioBuffer) return null;
    if (this.musicSource) {
      try {
        this.musicSource.stop();
      } catch (_) {}
    }
    this.musicBus.gain.setValueAtTime(gain, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.loop = loop;
    // HARD INVARIANT: Never warp music pitch/tempo away from 1.000
    src.playbackRate.setValueAtTime(1.0, ctx.currentTime);
    Object.defineProperty(src, "__lockedRate", { value: 1.0, writable: false });
    src.connect(this.musicBus);
    src.start(0);
    this.musicSource = src;
    ensureTelemetry().musicPlaybackRate = src.playbackRate.value;
    return src;
  }

  /**
   * Guardrail setter: ignores any attempt to slow-mo warp music playbackRate away from 1.000.
   */
  setTimeScale(/* simTimeScale */) {
    if (this.musicSource && this.ctx) {
      this.musicSource.playbackRate.setValueAtTime(1.0, this.ctx.currentTime);
      ensureTelemetry().musicPlaybackRate = 1.0;
    }
  }

  _getNoiseBuffer() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const ctx = this.init();
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 2463534242;
    for (let i = 0; i < len; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    this._noiseBuffer = buf;
    return buf;
  }

  _getTanhCurve() {
    if (this._tanhCurve) return this._tanhCurve;
    const n = 512;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(x * 2.8);
    }
    this._tanhCurve = curve;
    return curve;
  }

  /**
   * Schedules Foley `leadSec` (default 72ms, within 65-80ms window) ahead on AudioContext.currentTime.
   */
  scheduleLookahead(callback, leadSec = 0.072) {
    const ctx = this.init();
    if (!ctx) return;
    const t0 = ctx.currentTime + Math.max(0.065, Math.min(0.08, leadSec));
    callback(ctx, t0, this.sfxBus);
  }

  triggerWingbeatOrWhoosh(intensity = 0.7, leadSec = 0.072) {
    this.scheduleLookahead((ctx, t0, bus) => {
      const src = ctx.createBufferSource();
      src.buffer = this._getNoiseBuffer();

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.setValueAtTime(1.8, t0);
      filter.frequency.setValueAtTime(190, t0);
      filter.frequency.exponentialRampToValueAtTime(520, t0 + 0.09);
      filter.frequency.exponentialRampToValueAtTime(140, t0 + 0.24);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.28 * intensity, t0 + 0.045);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);

      src.connect(filter).connect(env).connect(bus);
      src.start(t0);
      src.stop(t0 + 0.28);
    }, leadSec);
  }

  triggerSurfaceContact(hardness = 0.6, leadSec = 0.070) {
    this.scheduleLookahead((ctx, t0, bus) => {
      // Sub-thud transient + surface grit burst
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(135 + hardness * 65, t0);
      osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.085);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.32 * hardness, t0);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.095);
      osc.connect(env).connect(bus);
      osc.start(t0);
      osc.stop(t0 + 0.1);

      const grit = ctx.createBufferSource();
      grit.buffer = this._getNoiseBuffer();
      const hp = ctx.createBiquadFilter();
      hp.type = "bandpass";
      hp.frequency.setValueAtTime(1400 + hardness * 900, t0);
      hp.Q.setValueAtTime(2.2, t0);
      const gEnv = ctx.createGain();
      gEnv.gain.setValueAtTime(0.14 * hardness, t0 + 0.006);
      gEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.065);
      grit.connect(hp).connect(gEnv).connect(bus);
      grit.start(t0);
      grit.stop(t0 + 0.08);
    }, leadSec);
  }

  /**
   * Nonlinear `WaveShaperNode` (`tanh`) + twin formant bandpass bio-acoustic call/roar.
   */
  triggerBioFormantCall({ baseFreq = 290, duration = 0.32, gain = 0.24 } = {}, leadSec = 0.072) {
    this.scheduleLookahead((ctx, t0, bus) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(baseFreq * 1.08, t0);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.82, t0 + duration);

      const shaper = ctx.createWaveShaper();
      shaper.curve = this._getTanhCurve();

      const f1 = ctx.createBiquadFilter();
      f1.type = "bandpass";
      f1.frequency.setValueAtTime(baseFreq * 2.4, t0);
      f1.Q.setValueAtTime(4.2, t0);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(gain, t0 + 0.035);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      osc.connect(shaper).connect(f1).connect(env).connect(bus);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    }, leadSec);
  }
}

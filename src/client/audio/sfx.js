/**
 * Minimal synthesized SFX (GDD feedback #7). Uses the Web Audio API to generate
 * short tactile sounds procedurally — no asset files needed, so it ships in the
 * bundle and works offline in the packaged app.
 *
 * ⚠️ NOTE: audio output cannot be verified in the headless build sandbox (no
 * audio device). The graph is standard WebAudio and plays in a real browser /
 * the packaged Electron app after the first user gesture (browsers suspend the
 * AudioContext until then).
 *
 *   SFX.click()        — crisp UI button tick
 *   SFX.impact(power)  — punchy combat hit (power 0..1 scales body)
 *   SFX.hurt()         — taking damage (lower, duller thud)
 */
class SfxEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  _ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(v) { this.enabled = v; }
  setVolume(v) { this._ensure(); if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v)); }

  /** @private generic envelope tone */
  _tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.08, gain = 0.3, attack = 0.002 }) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** @private short noise burst for punchy impacts */
  _noise({ dur = 0.09, gain = 0.4, lowpass = 1800 }) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = lowpass;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  /** Crisp UI button tick (#7). */
  click() { this._tone({ type: 'square', freq: 660, freqEnd: 880, dur: 0.05, gain: 0.18 }); }

  /** Punchy combat impact (#7). power 0..1 scales the thud body. */
  impact(power = 0.5) {
    const p = Math.max(0, Math.min(1, power));
    this._noise({ dur: 0.08 + p * 0.05, gain: 0.35 + p * 0.25, lowpass: 1200 + p * 1500 });
    this._tone({ type: 'sine', freq: 180 - p * 60, freqEnd: 60, dur: 0.12, gain: 0.3 });
  }

  /** Taking damage — duller, lower (#7). */
  hurt() { this._tone({ type: 'triangle', freq: 150, freqEnd: 70, dur: 0.14, gain: 0.28 }); }

  /** #6 Footstep — a short crunchy gravel/sand noise burst with a soft thud. */
  footstep() {
    this._noise({ dur: 0.06, gain: 0.18, lowpass: 2600 });
    this._tone({ type: 'sine', freq: 90, freqEnd: 55, dur: 0.05, gain: 0.08 });
  }
}

export const SFX = new SfxEngine();

/**
 * Attach a global click sound to every UI button press (#7). Call once at boot.
 * Uses capture-phase delegation so it covers all current + future buttons.
 */
export function installUiClickSound(root = document) {
  root.addEventListener('pointerdown', (e) => {
    const el = e.target;
    if (el && el.closest && el.closest('button, .tab, .bet, .join, .mcb-slot, .start')) SFX.click();
  }, true);
}

/**
 * The audio side of the Dex orb.
 *
 * Microphone -> MediaStreamAudioSourceNode -> AnalyserNode -> metrics, read once
 * per animation frame by the visualiser. Nothing here touches React state: the
 * engine is a mutable object the render loop polls, because a metric that
 * arrives 60 times a second is not state, it is a signal.
 *
 * SOURCE-AGNOSTIC. `attachStream` takes any MediaStream and `attachElement` any
 * <audio>/<video>, so the same engine drives the visual whether the user is
 * speaking or the assistant is. The assistant path is built but not exercised:
 * this product has no TTS today, so nothing yet produces an assistant stream to
 * attach. It is here so that when one exists the visualiser does not have to
 * change — not because it is currently doing anything.
 *
 * SMOOTHING IS ASYMMETRIC. A single lerp cannot be both "reacts the instant you
 * speak" and "settles gently when you stop" — one coefficient has to lose. So
 * rise and fall are separate: volume attacks in ~3 frames and releases over
 * ~30. Bands get their own pairs, because high frequencies should flicker and
 * low ones should heave.
 */

// Per-metric { attack, release }. Higher = faster. Tuned against real speech
// rather than derived: these are the numbers where a spoken sentence reads as
// one continuous gesture instead of a series of taps.
const SMOOTH = {
  volume: { attack: 0.38, release: 0.055 },
  low: { attack: 0.22, release: 0.05 },
  mid: { attack: 0.30, release: 0.09 },
  high: { attack: 0.46, release: 0.16 },
};

const lerpTo = (current, target, k) => current + (target - current) * k;

/** Asymmetric approach — fast toward a louder value, slow toward a quieter one. */
function approach(current, target, { attack, release }) {
  return lerpTo(current, target, target > current ? attack : release);
}

export class DexAudioEngine {
  constructor({ demoMode = false } = {}) {
    this.demoMode = demoMode;
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.timeData = null;
    this.freqData = null;
    this.ownedStream = null;

    // Smoothed, 0..1. What the visualiser reads.
    this.metrics = { volume: 0, low: 0, mid: 0, high: 0, peak: 0 };
    // Raw of the last frame, for speech detection.
    this.rawVolume = 0;
    this.active = false;

    // Speech gate with hysteresis: one threshold flickers on and off around
    // the noise floor and would strobe the whole visual.
    this.speaking = false;
    this._speechOnAt = 0.045;
    this._speechOffAt = 0.022;
    this.lastVoiceAt = 0;

    this._t0 = typeof performance !== "undefined" ? performance.now() : 0;
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.analyser = this.ctx.createAnalyser();
    // 2048 gives ~23Hz bins at 48k — enough to separate a voice's fundamental
    // from its sibilance, which is the whole point of splitting into bands.
    this.analyser.fftSize = 2048;
    // Kept low: the AnalyserNode's own smoothing fights ours, and ours is the
    // one that knows the difference between attack and release.
    this.analyser.smoothingTimeConstant = 0.25;
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    return this.ctx;
  }

  /** Hang the analyser on a stream someone else owns (the capture recorder). */
  attachStream(stream) {
    if (!stream) return false;
    if (!this._ensureContext()) return false;
    this.detachSource();
    try {
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      // Deliberately NOT connected to destination — monitoring a live mic
      // through the speakers is a feedback loop.
      this.active = true;
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  /** For assistant playback, when there is any. Unused today — see the header. */
  attachElement(el) {
    if (!el || !this._ensureContext()) return false;
    this.detachSource();
    try {
      this.source = this.ctx.createMediaElementSource(el);
      this.source.connect(this.analyser);
      this.analyser.connect(this.ctx.destination); // playback must still be heard
      this.active = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Open our own microphone. Only used if no stream is handed to us. */
  async openMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.ownedStream = stream;
      return this.attachStream(stream);
    } catch {
      return false; // permission denied — caller falls back to demo/idle
    }
  }

  detachSource() {
    try { this.source?.disconnect(); } catch { /* already gone */ }
    this.source = null;
    this.active = false;
  }

  stop() {
    this.detachSource();
    this.ownedStream?.getTracks().forEach((t) => t.stop());
    this.ownedStream = null;
    if (this.ctx && this.ctx.state !== "closed") this.ctx.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.metrics = { volume: 0, low: 0, mid: 0, high: 0, peak: 0 };
    this.rawVolume = 0;
    this.speaking = false;
  }

  /**
   * Synthetic speech-shaped signal, for when there is no microphone: a slow
   * carrier, a faster tremor, and occasional bursts, so the visual can be
   * judged without granting permission. Never used when a real source is live.
   */
  _demoMetrics(now) {
    const t = (now - this._t0) / 1000;
    const phrase = Math.max(0, Math.sin(t * 0.42) - 0.08);        // speak/pause
    const syllable = 0.5 + 0.5 * Math.sin(t * 7.3);               // syllable rate
    const tremor = 0.5 + 0.5 * Math.sin(t * 19.7 + Math.sin(t * 3.1));
    const burst = Math.pow(Math.max(0, Math.sin(t * 0.23 + 1.2)), 8);
    const v = Math.min(1, phrase * (0.42 + 0.4 * syllable) + burst * 0.5);
    return {
      volume: v,
      low: v * (0.62 + 0.3 * Math.sin(t * 1.1)),
      mid: v * (0.5 + 0.45 * syllable),
      high: v * (0.28 + 0.5 * tremor) * (0.4 + 0.6 * burst),
    };
  }

  /**
   * Read one frame. Returns the smoothed metrics object (the same instance —
   * do not keep references expecting a snapshot).
   */
  sample(now = performance.now()) {
    let target;

    if (this.active && this.analyser) {
      this.analyser.getByteTimeDomainData(this.timeData);
      let sum = 0;
      for (let i = 0; i < this.timeData.length; i++) {
        const v = (this.timeData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.timeData.length);
      this.rawVolume = rms;

      this.analyser.getByteFrequencyData(this.freqData);
      const nyquist = (this.ctx?.sampleRate || 48000) / 2;
      const binHz = nyquist / this.freqData.length;
      // Bands must be COMPARABLE, and a plain mean does not make them so: the
      // low band spans ~10 bins and the high band ~257, so the wide one divides
      // its energy by twenty-five times more bins and reads near zero no matter
      // what is happening. Measured with a 5.2kHz tone: peak bin 221 pinned at
      // 255, band mean 0.012. The sparkle would never have fired on real
      // speech. Blending in the band's PEAK fixes it — peak is independent of
      // how wide the band is — while keeping enough of the mean that one hot
      // bin cannot carry the whole band on its own.
      const band = (fromHz, toHz) => {
        const a = Math.max(1, Math.floor(fromHz / binHz));
        const b = Math.min(this.freqData.length - 1, Math.ceil(toHz / binHz));
        if (b <= a) return 0;
        let sum = 0, peak = 0;
        for (let i = a; i <= b; i++) {
          const v = this.freqData[i];
          sum += v;
          if (v > peak) peak = v;
        }
        const mean = sum / (b - a + 1);
        return Math.min(1, (mean * 0.35 + peak * 0.65) / 255);
      };

      target = {
        // The curve lifts ordinary speech off the floor; raw RMS for a person
        // talking at arm's length sits around 0.05-0.15 and would barely move.
        volume: Math.min(1, Math.pow(rms * 3.4, 0.62)),
        low: band(20, 250),
        mid: band(250, 2000),
        high: band(2000, 8000),
      };

      const on = rms > this._speechOnAt;
      const off = rms < this._speechOffAt;
      if (on) { this.speaking = true; this.lastVoiceAt = now; }
      else if (off) this.speaking = false;
    } else if (this.demoMode) {
      target = this._demoMetrics(now);
      this.rawVolume = target.volume * 0.2;
      this.speaking = target.volume > 0.25;
      if (this.speaking) this.lastVoiceAt = now;
    } else {
      target = { volume: 0, low: 0, mid: 0, high: 0 };
      this.rawVolume = 0;
      this.speaking = false;
    }

    const m = this.metrics;
    m.volume = approach(m.volume, target.volume, SMOOTH.volume);
    m.low = approach(m.low, target.low, SMOOTH.low);
    m.mid = approach(m.mid, target.mid, SMOOTH.mid);
    m.high = approach(m.high, target.high, SMOOTH.high);
    // Peak decays on its own clock so a shout leaves a visible wake.
    m.peak = Math.max(m.volume, m.peak * 0.94);
    return m;
  }
}

export default DexAudioEngine;

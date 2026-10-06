// ORI — procedural audio engine.
// Every sound is synthesized at runtime with the Web Audio API, so the repo
// ships no binary audio files. An ambient pad plays when enabled; UI gestures
// trigger short synthesized cues. Audio only starts after a user gesture, per
// browser autoplay policy.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientGain = null;
    this.enabled = false;
    this.started = false;
    this._nodes = [];
  }

  // Create the context lazily (must be inside a user-gesture handler).
  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);

    // gentle master low-pass to keep things soft
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    this.master.disconnect();
    this.master.connect(lp);
    lp.connect(this.ctx.destination);
  }

  _buildAmbient() {
    const ctx = this.ctx;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.0;
    this.ambientGain.connect(this.master);

    // Stacked detuned sines form a slow, evolving pad (a "data center hum").
    const freqs = [55, 82.4, 110, 164.8, 220];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = f;

      const g = ctx.createGain();
      g.gain.value = 0.16 / (i + 1);

      // slow LFO on gain for breathing movement
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.017;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.06 / (i + 1);
      lfo.connect(lfoGain).connect(g.gain);

      osc.connect(g).connect(this.ambientGain);
      osc.start(); lfo.start();
      this._nodes.push(osc, lfo);
    });

    // a touch of filtered noise shimmer
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    noise.buffer = buf; noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.value = 0.015;
    noise.connect(bp).connect(ng).connect(this.ambientGain);
    noise.start();
    this._nodes.push(noise);
  }

  _ramp(param, to, time = 0.4) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + time);
  }

  async enable() {
    this._ensure();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.started) { this._buildAmbient(); this.started = true; }
    this.enabled = true;
    this._ramp(this.master.gain, 0.5, 0.8);
    this._ramp(this.ambientGain.gain, 0.5, 2.5);
    return true;
  }

  disable() {
    if (!this.ctx) return;
    this.enabled = false;
    this._ramp(this.ambientGain.gain, 0.0, 0.8);
    this._ramp(this.master.gain, 0.0, 0.8);
  }

  async toggle() {
    if (this.enabled) { this.disable(); return false; }
    await this.enable(); return true;
  }

  // --- one-shot UI cues ----------------------------------------------------
  play(name) {
    if (!this.enabled || !this.ctx) return;
    switch (name) {
      case 'hover':   this._blip(880, 0.04, 'sine', 0.05); break;
      case 'click':   this._blip(520, 0.07, 'triangle', 0.09); break;
      case 'confirm': this._arp([523, 659, 784, 1046], 0.09); break;
      case 'whoosh':  this._whoosh(); break;
      case 'success': this._arp([659, 784, 988, 1318, 1568], 0.08); break;
      default: break;
    }
  }

  _blip(freq, dur, type = 'sine', vol = 0.08) {
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(this.master);
    osc.start(now); osc.stop(now + dur + 0.02);
  }

  _arp(freqs, step = 0.08) {
    freqs.forEach((f, i) => setTimeout(() => this._blip(f, 0.12, 'sine', 0.06), i * step * 1000));
  }

  _whoosh() {
    const ctx = this.ctx, now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(3000, now + 0.4);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.08, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    noise.connect(bp).connect(g).connect(this.master);
    noise.start(now); noise.stop(now + 0.5);
  }
}

export const Audio = new AudioEngine();
export default Audio;

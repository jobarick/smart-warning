import type { SirenTone } from '../types';

interface ToneSpec {
  wave: OscillatorType;
  baseFreq: number;
  lfoWave: OscillatorType;
  lfoFreq: number;
  lfoDepth: number;
  mode: 'fm' | 'am';
}

/** All sirens are synthesized — an oscillator whose frequency (fm) or amplitude (am) is swept by an LFO. */
const TONES: Record<SirenTone, ToneSpec> = {
  wail: { wave: 'sawtooth', baseFreq: 600, lfoWave: 'sine', lfoFreq: 0.4, lfoDepth: 220, mode: 'fm' },
  yelp: { wave: 'sawtooth', baseFreq: 700, lfoWave: 'sine', lfoFreq: 4, lfoDepth: 250, mode: 'fm' },
  hilo: { wave: 'square', baseFreq: 540, lfoWave: 'square', lfoFreq: 1, lfoDepth: 120, mode: 'fm' },
  pulse: { wave: 'square', baseFreq: 880, lfoWave: 'square', lfoFreq: 3, lfoDepth: 0.5, mode: 'am' },
};

class SirenEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: { osc: OscillatorNode; lfo: OscillatorNode; lfoGain: GainNode; amp: GainNode } | null = null;
  playing: SirenTone | null = null;

  get armed(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture at least once — browsers block audio until then. */
  async arm(): Promise<boolean> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') {
      await this.ctx.resume().catch(() => {});
    }
    return this.armed;
  }

  setVolume(v: number) {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(Math.max(0.0001, v), this.ctx.currentTime, 0.05);
    }
  }

  start(tone: SirenTone, volume: number) {
    if (!this.ctx || !this.master) return;
    this.stop();
    this.setVolume(volume);
    const spec = TONES[tone];
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = spec.wave;
    osc.frequency.value = spec.baseFreq;

    const amp = ctx.createGain();
    amp.gain.value = spec.mode === 'am' ? 0.5 : 1;

    const lfo = ctx.createOscillator();
    lfo.type = spec.lfoWave;
    lfo.frequency.value = spec.lfoFreq;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = spec.lfoDepth;
    lfo.connect(lfoGain);
    if (spec.mode === 'fm') {
      lfoGain.connect(osc.frequency);
    } else {
      lfoGain.connect(amp.gain);
    }

    osc.connect(amp);
    amp.connect(this.master);
    osc.start();
    lfo.start();
    this.nodes = { osc, lfo, lfoGain, amp };
    this.playing = tone;
  }

  stop() {
    if (!this.nodes) return;
    const { osc, lfo, lfoGain, amp } = this.nodes;
    try {
      osc.stop();
      lfo.stop();
    } catch {
      // already stopped
    }
    osc.disconnect();
    lfo.disconnect();
    lfoGain.disconnect();
    amp.disconnect();
    this.nodes = null;
    this.playing = null;
  }
}

export const siren = new SirenEngine();

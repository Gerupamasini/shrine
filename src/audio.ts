import * as T from "three";
import { publicUrl } from "./urls";
import type { InstanceRow, World } from "./world/data";

/**
 * Evening soundscape. BGM-free.
 *  - Higurashi: a real CC BY 4.0 field recording (Wikimedia Commons, Σ64), played from
 *    several HRTF sources anchored in the forest around the listener, each from its own
 *    offset and rate so the 96 s source never repeats audibly; plus a distant stereo bed.
 *  - Stream and wind/leaves are synthesised (filtered noise with gusts) and labelled as such.
 * Gains follow the time of day and the place (river, forest, shrine height).
 */
type Voice = { src: AudioBufferSourceNode; gain: GainNode; pan: PannerNode; anchor: T.Vector3; base: number; next: number };

function noiseBuffer(ctx: AudioContext, seconds: number, colour: "pink" | "brown") {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (colour === "pink") {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  // crossfade the loop seam
  const f = Math.floor(ctx.sampleRate * 0.25);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    d[i] = d[i] * t + d[n - f + i] * (1 - t);
  }
  return buf;
}

export class Soundscape {
  context: AudioContext | null = null;
  muted = false;
  status = "off";
  master!: GainNode;
  higurashi: Voice[] = [];
  bed!: GainNode;
  stream: { gain: GainNode; pan: PannerNode }[] = [];
  wind!: GainNode;
  leaves!: GainNode;
  leafFilter!: BiquadFilterNode;
  windFilter!: BiquadFilterNode;
  private t = 0;
  async start() {
    if (this.context) return;
    const ctx = new AudioContext();
    this.context = ctx;
    this.status = "loading";
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, ctx.currentTime, 1.5);
    const fmt = new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
    const load = async (name: string) => ctx.decodeAudioData(await (await fetch(publicUrl(`assets/audio/${name}.${fmt}`))).arrayBuffer());
    const [mono, stereo] = await Promise.all([load("higurashi-tanna-mono"), load("higurashi-tanna-stereo")]);
    // distant chorus bed (stereo, softened)
    {
      const s = ctx.createBufferSource();
      s.buffer = stereo;
      s.loop = true;
      s.playbackRate.value = 0.985;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 5200;
      this.bed = ctx.createGain();
      this.bed.gain.value = 0.16;
      s.connect(lp).connect(this.bed).connect(this.master);
      s.start(0, 31.7);
    }
    for (let i = 0; i < 5; i++) {
      const src = ctx.createBufferSource();
      src.buffer = mono;
      src.loop = true;
      src.playbackRate.value = 0.965 + i * 0.017;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 9, rolloffFactor: 1.15, maxDistance: 400 });
      src.connect(gain).connect(pan).connect(this.master);
      src.start(0, (i * 19.3) % mono.duration);
      this.higurashi.push({ src, gain, pan, anchor: new T.Vector3(1e9, 0, 0), base: 0.55 + Math.random() * 0.35, next: 0 });
    }
    // stream: brown + pink noise through resonant bands, three moving sources along the river
    const brown = noiseBuffer(ctx, 9, "brown"), pink = noiseBuffer(ctx, 7, "pink");
    for (let i = 0; i < 3; i++) {
      const a = ctx.createBufferSource(), b = ctx.createBufferSource();
      a.buffer = brown;
      b.buffer = pink;
      a.loop = b.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 650 + i * 240;
      bp.Q.value = 0.7;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800 + i * 500;
      const mix = ctx.createGain();
      const gain = ctx.createGain();
      gain.gain.value = 0.0;
      const pan = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 4, rolloffFactor: 1.4, maxDistance: 300 });
      a.connect(bp).connect(mix);
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      b.connect(hp).connect(g2).connect(mix);
      mix.connect(gain).connect(pan).connect(this.master);
      // babbling: slow random modulation of the band
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.7 + i * 0.37;
      const lg = ctx.createGain();
      lg.gain.value = 180;
      lfo.connect(lg).connect(bp.frequency);
      lfo.start();
      a.start(0, i * 2.1);
      b.start(0, i * 1.7);
      this.stream.push({ gain, pan });
    }
    // wind and leaves (non-positional, gusting)
    {
      const n = ctx.createBufferSource();
      n.buffer = brown;
      n.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = "lowpass";
      this.windFilter.frequency.value = 420;
      this.wind = ctx.createGain();
      this.wind.gain.value = 0.0;
      n.connect(this.windFilter).connect(this.wind).connect(this.master);
      n.start(0, 4.3);
      const l = ctx.createBufferSource();
      l.buffer = pink;
      l.loop = true;
      this.leafFilter = ctx.createBiquadFilter();
      this.leafFilter.type = "bandpass";
      this.leafFilter.frequency.value = 3400;
      this.leafFilter.Q.value = 0.5;
      this.leaves = ctx.createGain();
      this.leaves.gain.value = 0.0;
      l.connect(this.leafFilter).connect(this.leaves).connect(this.master);
      l.start(0, 2.2);
    }
    this.status = "playing";
  }
  private chimeAt = -1e9;
  /**
   * The village radio's evening chime (bosai musen, 18:00 in summer): "Yuyake Koyake", melody by
   * Kusakawa Shin (1923, public domain; the tune only, no lyrics), synthesised as an electronic
   * chime through PA horn speakers on the fire lookout, with echoes off the hills around the
   * valley and a long soft tail.
   */
  chime(at: T.Vector3, delay = 0) {
    const ctx = this.context;
    if (!ctx || this.status === "loading") return;
    if (ctx.currentTime - this.chimeAt < 60) return;
    this.chimeAt = ctx.currentTime;
    const t0 = ctx.currentTime + delay, BEAT = 0.78, TONIC = 523.25;
    // [semitones above the low do (null = rest), beats] - C major, 4/4, eight bars
    const R = null;
    const tune: [number | null, number][] = [
      [7, .5], [7, .5], [7, .5], [9, .5], [7, .5], [7, .5], [7, .5], [4, .5],
      [0, .5], [0, .5], [2, .5], [4, .5], [2, 1], [R, 1],
      [4, 1], [4, .5], [7, .5], [9, .5], [12, .5], [12, .5], [9, .5],
      [7, .5], [7, .5], [9, .5], [7, .5], [12, 1.5], [R, .5],
      [12, .75], [14, .25], [12, .5], [9, .5], [12, .5], [12, .5], [7, .5], [7, .5],
      [9, .5], [7, .5], [9, .5], [7, .5], [4, 1.5], [R, .5],
      [7, .5], [4, .5], [2, .5], [0, .5], [2, .5], [2, .5], [0, .5], [2, .5],
      [4, .5], [7, .5], [9, .5], [7, .5], [12, 2.5],
    ];
    // horn speaker: band-limited, a little gritty
    const bus = ctx.createGain();
    bus.gain.value = 0.2;
    const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 380, Q: 0.7 });
    const pk = new BiquadFilterNode(ctx, { type: "peaking", frequency: 2300, Q: 1.1, gain: 5 });
    const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 4300, Q: 0.6 });
    const sat = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(1.8 * x) / Math.tanh(1.8); }
    sat.curve = curve;
    bus.connect(hp).connect(pk).connect(sat).connect(lp);
    const pan = new PannerNode(ctx, { panningModel: "equalpower", distanceModel: "inverse", refDistance: 45, rolloffFactor: 0.7, maxDistance: 3000, positionX: at.x, positionY: at.y, positionZ: at.z });
    lp.connect(pan).connect(this.master);
    // echoes from the hills: later, darker, from either side
    for (const [d, g, p] of [[0.43, 0.3, -0.55], [1.07, 0.22, 0.6], [1.9, 0.15, -0.3], [2.95, 0.09, 0.4]]) {
      const dl = new DelayNode(ctx, { delayTime: d, maxDelayTime: 4 });
      const f = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 1900 - d * 300 });
      const gn = new GainNode(ctx, { gain: g });
      lp.connect(dl).connect(f).connect(gn).connect(new StereoPannerNode(ctx, { pan: p })).connect(this.master);
    }
    // valley tail: a synthetic 3.4 s impulse
    const n = Math.floor(ctx.sampleRate * 3.4), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.9)) * Math.min(1, i / (ctx.sampleRate * 0.08));
    }
    const conv = new ConvolverNode(ctx, { buffer: ir });
    lp.connect(conv).connect(new GainNode(ctx, { gain: 0.16 })).connect(this.master);
    let beat = 0;
    for (const [semi, len] of tune) {
      const start = t0 + beat * BEAT, end = start + len * BEAT;
      beat += len;
      if (semi === null) continue;
      const f0 = TONIC * Math.pow(2, semi / 12);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(1, start + 0.012);
      env.gain.setTargetAtTime(0.42, start + 0.012, 0.18);
      env.gain.setTargetAtTime(0.0001, end - 0.04, 0.22);
      env.connect(bus);
      for (const [mul, g] of [[1, 1], [2, 0.26], [3.01, 0.07], [4.2, 0.025]]) {
        const o = new OscillatorNode(ctx, { type: "sine", frequency: f0 * mul });
        const og = new GainNode(ctx, { gain: g });
        o.connect(og).connect(env);
        o.start(start);
        o.stop(end + 1.2);
      }
    }
    // free the graph once the tail has died away
    window.setTimeout(() => bus.disconnect(), (delay + beat * BEAT + 8) * 1000);
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (!this.context) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.context.currentTime, 0.4);
    this.status = m ? "muted" : "playing";
  }
  private forestPoint(w: World, around: T.Vector3, k: number) {
    // a sugi/hinoki/broadleaf tree 18-70 m away; deterministic per voice and position bucket
    const rows = [...(w.trees.sugi ?? []), ...(w.trees.hinoki ?? []), ...(w.trees.broadleaf ?? [])];
    let best: InstanceRow | null = null, bestScore = 1e9;
    const want = 22 + k * 11;
    for (let i = (k * 977) % 37; i < rows.length; i += 37) {
      const r = rows[i];
      const d = Math.hypot(r[0] - around.x, r[2] - around.z);
      const ang = Math.atan2(r[0] - around.x, r[2] - around.z);
      const score = Math.abs(d - want) + Math.abs(((ang - k * 1.26 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 6;
      if (score < bestScore) (bestScore = score), (best = r);
    }
    return best ? new T.Vector3(best[0], best[1] + 10, best[2]) : around.clone().add(new T.Vector3(30, 10, 0));
  }
  update(cam: T.Camera, w: World, time: number) {
    const ctx = this.context;
    if (!ctx || this.status === "loading") return;
    const now = ctx.currentTime;
    const p = cam.position;
    const l = ctx.listener;
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, now, 0.05);
      l.positionY.setTargetAtTime(p.y, now, 0.05);
      l.positionZ.setTargetAtTime(p.z, now, 0.05);
      l.forwardX.setTargetAtTime(fwd.x, now, 0.05);
      l.forwardY.setTargetAtTime(fwd.y, now, 0.05);
      l.forwardZ.setTargetAtTime(fwd.z, now, 0.05);
      l.upX.setTargetAtTime(up.x, now, 0.05);
      l.upY.setTargetAtTime(up.y, now, 0.05);
      l.upZ.setTargetAtTime(up.z, now, 0.05);
    }
    this.t += 1 / 60;
    // time of day: higurashi strongest 17:45-18:40, fading into dusk
    const hig = T.MathUtils.smoothstep(time, 17.0, 17.75) * (1 - T.MathUtils.smoothstep(time, 18.6, 19.05)) * 0.85 + 0.15;
    // place: forest density around the listener
    const forest = T.MathUtils.clamp(this.forestCount(w, p) / 30, 0, 1);
    const height = T.MathUtils.smoothstep(p.y, 20, 42);
    for (let k = 0; k < this.higurashi.length; k++) {
      const v = this.higurashi[k];
      if (v.anchor.distanceTo(p) > 85 || v.anchor.x > 1e8) {
        v.anchor.copy(this.forestPoint(w, p, k));
        v.pan.positionX.setValueAtTime(v.anchor.x, now);
        v.pan.positionY.setValueAtTime(v.anchor.y, now);
        v.pan.positionZ.setValueAtTime(v.anchor.z, now);
      }
      if (now > v.next) {
        // individual cicadas swell and pause
        const on = Math.random() < 0.78;
        v.gain.gain.setTargetAtTime(on ? v.base * hig * (0.6 + forest * 0.6) : 0.0, now, on ? 1.2 : 2.5);
        v.next = now + 4 + Math.random() * 9;
      }
    }
    this.bed.gain.setTargetAtTime((0.1 + 0.12 * forest) * hig, now, 1.5);
    // stream: the two drops (overfalls) nearest to the listener and the riffle closest to them
    const R = w.data.river, bed = R.bed.points;
    const near = [...R.drops].sort((a, b) => Math.abs(a.z - p.z) - Math.abs(b.z - p.z));
    const bi = T.MathUtils.clamp(Math.round((p.z - bed[0][1]) / (bed[1][1] - bed[0][1])), 0, bed.length - 1);
    const here = bed[bi];
    const srcs: [number, number, number, number][] = [
      ...near.slice(0, 2).map((d) => [d.x, d.waterBelow + 0.3, d.z + 0.6, d.kind === "weir" ? 1.0 : 0.75 * Math.min(1, (d.waterAbove - d.waterBelow) / 0.45)] as [number, number, number, number]),
      [here[0], here[3] - 1.4, here[1], 0.35],
    ];
    const bd = Math.abs(p.x - here[0]);
    this.stream.forEach((s, i) => {
      const [x, y, z, g] = srcs[i];
      s.pan.positionX.setTargetAtTime(x, now, 0.3);
      s.pan.positionY.setTargetAtTime(y, now, 0.3);
      s.pan.positionZ.setTargetAtTime(z, now, 0.3);
      s.gain.gain.setTargetAtTime(bd < 180 ? 0.7 * g : 0.0, now, 1.0);
    });
    // wind: gusts, stronger and broader on the shrine height and in the trees
    const gust = 0.55 + 0.3 * Math.sin(this.t * 0.21) + 0.15 * Math.sin(this.t * 0.73 + 1.3);
    this.wind.gain.setTargetAtTime((0.05 + 0.1 * height) * gust, now, 0.8);
    this.windFilter.frequency.setTargetAtTime(300 + 260 * gust + 200 * height, now, 0.8);
    this.leaves.gain.setTargetAtTime((0.012 + 0.05 * forest) * gust * gust, now, 0.6);
  }
  private fc = { at: new T.Vector3(1e9, 0, 0), n: 0 };
  private forestCount(w: World, p: T.Vector3) {
    if (this.fc.at.distanceTo(p) < 8) return this.fc.n;
    let n = 0;
    for (const k of ["sugi", "hinoki", "broadleaf", "keyaki", "bamboo"])
      for (const r of w.trees[k] ?? []) if (Math.abs(r[0] - p.x) < 30 && Math.abs(r[2] - p.z) < 30) n++;
    this.fc.at.copy(p);
    this.fc.n = n;
    return n;
  }
}

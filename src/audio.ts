import * as T from "three";
export class Soundscape {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  muted = true;
  sources: AudioBufferSourceNode[] = [];
  stream: PannerNode | null = null;
  status = "未開始";
  async start() {
    if (this.context) {
      await this.context.resume();
      this.setMuted(false);
      return;
    }
    this.context = new AudioContext();
    await this.context.resume();
    this.master = this.context.createGain();
    this.master.gain.value = 0.48;
    this.master.connect(this.context.destination);
    this.status = "読込中";
    try {
      await Promise.all([
        this.sound("summer-insects-synth.wav", [-10, 15, -55], 0.55),
        this.sound("summer-insects-synth.wav", [23, 47, -140], 0.5, 17),
        this.sound("wind-synth.wav", [0, 45, -125], 0.55, 9),
        this.sound("stream-synth.wav", [85, 1, 115], 0.75, 0, true),
      ]);
      this.muted = false;
      this.status = "合成環境音";
    } catch (e) {
      this.status = "音源読込失敗";
      throw e;
    }
  }
  async sound(
    file: string,
    position: number[],
    gain: number,
    offset = 0,
    river = false,
  ) {
    const ctx = this.context!;
    const res = await fetch("/assets/audio/" + file);
    if (!res.ok) throw Error(file);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const p = new PannerNode(ctx, {
      panningModel: "HRTF",
      distanceModel: "inverse",
      refDistance: river ? 8 : 22,
      maxDistance: 350,
      rolloffFactor: river ? 1.2 : 0.6,
      positionX: position[0],
      positionY: position[1],
      positionZ: position[2],
    });
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(p);
    p.connect(this.master!);
    src.start(0, offset);
    this.sources.push(src);
    if (river) this.stream = p;
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        m ? 0 : 0.48,
        this.context.currentTime,
        0.3,
      );
  }
  update(camera: T.PerspectiveCamera) {
    if (!this.context) return;
    const l = this.context.listener,
      p = camera.position,
      d = camera.getWorldDirection(new T.Vector3());
    l.positionX.value = p.x;
    l.positionY.value = p.y;
    l.positionZ.value = p.z;
    l.forwardX.value = d.x;
    l.forwardY.value = d.y;
    l.forwardZ.value = d.z;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
    if (this.stream) {
      const z = T.MathUtils.clamp(p.z, -15, 370);
      this.stream.positionX.value = 83 + 9 * Math.sin(z * 0.025);
      this.stream.positionZ.value = z;
      this.stream.positionY.value = 0;
    }
  }
}

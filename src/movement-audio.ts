import type { Soundscape } from './audio';
import type { Surface } from './world/surface';
/** Synthesised movement layers, sharing the environmental mute/master bus. */
export class MovementAudio {
  private engine?: OscillatorNode;
  private gain?: GainNode;
  private step = 0;
  private rolling?: GainNode;
  private rollingFilter?: BiquadFilterNode;
  update(sound: Soundscape, dt: number, speed: number, driving: boolean, grounded: boolean, surface: Surface) {
    const ctx=sound.context;
    if (!ctx || !sound.master) return;
    if (!this.engine) {
      this.engine=ctx.createOscillator(); this.engine.type='triangle';
      this.gain=ctx.createGain(); this.gain.gain.value=0;
      const low=ctx.createBiquadFilter(); low.frequency.value=420;
      this.engine.connect(low).connect(this.gain).connect(sound.master); this.engine.start();
      const noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate), samples=noise.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
      const source=ctx.createBufferSource();source.buffer=noise;source.loop=true;
      this.rollingFilter=ctx.createBiquadFilter();this.rollingFilter.type='lowpass';
      this.rolling=ctx.createGain();this.rolling.gain.value=0;
      source.connect(this.rollingFilter).connect(this.rolling).connect(sound.master);source.start();
    }
    this.engine.frequency.setTargetAtTime(32+Math.min(speed,17)*4,ctx.currentTime,.15);
    this.gain!.gain.setTargetAtTime(driving ? .07+Math.min(speed,17)*.003 : 0,ctx.currentTime,.08);
    this.rollingFilter!.frequency.setTargetAtTime(surface==='gravel'?1700:surface==='grass'?450:800,ctx.currentTime,.1);
    this.rolling!.gain.setTargetAtTime(driving?Math.min(speed/17,1)*(surface==='gravel'?.07:.035):0,ctx.currentTime,.1);
    if (!grounded || driving || speed<.2) { this.step=0; return; }
    this.step+=dt*speed;
    const stride = speed > 3 ? 1.6 : .8;
    if(this.step<stride) return;
    this.step%=stride;
    const duration=surface==='asphalt'?.09:surface==='gravel'?.14:.18;
    const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate);
    const values=buffer.getChannelData(0);
    for(let i=0;i<values.length;i++) values[i]=(Math.random()*2-1)*Math.exp(-i/values.length*6);
    const source=ctx.createBufferSource();source.buffer=buffer;
    const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=surface==='gravel'?2600:surface==='grass'?700:1200;
    const gain=ctx.createGain();gain.gain.value=surface==='grass'?.12:.19;
    source.connect(filter).connect(gain).connect(sound.master);
    source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};source.start();
  }
}

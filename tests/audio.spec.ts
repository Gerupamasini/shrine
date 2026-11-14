import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import ts from 'typescript';
test('movement audio produces footsteps and engine output, respects airborne state and mute bus',async({page})=>{
 await page.goto('about:blank');
 const code=ts.transpileModule(fs.readFileSync('src/movement-audio.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace('export class MovementAudio','window.MovementAudio = class MovementAudio');
 await page.addScriptTag({content:code});
 const peaks=await page.evaluate(async()=>{
  const peaks:Record<string,number>={};
  for(const mode of ['walk','drive','air','muted']){
   const ctx=new OfflineAudioContext(1,22050,22050), master=ctx.createGain();master.gain.value=mode==='muted'?0:1;master.connect(ctx.destination);
   const sound={context:ctx,master}, audio=new (window as any).MovementAudio();
   for(let i=0;i<60;i++)audio.update(sound,1/60,mode==='drive'?5:1.5,mode==='drive',mode!=='air','gravel');
   const rendered=await ctx.startRendering();let peak=0;
   for(const v of rendered.getChannelData(0))peak=Math.max(peak,Math.abs(v));peaks[mode]=peak;
  }
  return peaks;
 });
 expect(peaks.walk).toBeGreaterThan(.01);expect(peaks.drive).toBeGreaterThan(.001);
 expect(peaks.air).toBe(0);expect(peaks.muted).toBe(0);
});

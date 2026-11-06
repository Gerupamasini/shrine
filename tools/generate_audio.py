"""Original synthesized sound design. Not field recordings of Japanese cicadas."""
from pathlib import Path
import numpy as np, wave
out=Path(__file__).resolve().parents[1]/'public/assets/audio';out.mkdir(exist_ok=True)
sr=22050;duration=53;t=np.arange(sr*duration)/sr;rng=np.random.default_rng(19940821)
def save(name,a):
 a=np.tanh(a);a*=.65/max(.65,np.max(np.abs(a)))
 with wave.open(str(out/name),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr);f.writeframes((a*32767).astype('<i2').tobytes())
# Irregular, descending pitched summer insect phrases with long quiet spaces.
s=np.zeros_like(t)
for start in [1.3,7.8,15.1,23.5,31.2,40.7,47.8]:
 for j in range(5):
  a=start+j*.39+rng.uniform(-.035,.035);local=t-a;env=np.where((local>0)&(local<.65),np.sin(np.clip(local/.65,0,1)*np.pi)**2,0)
  frequency=2500-j*135+160*np.sin(local*12)*np.exp(-np.maximum(0,local)*5)
  phase=2*np.pi*np.cumsum(frequency)/sr
  s+=env*(np.sin(phase)+.2*np.sin(phase*2.01))*.13
save('summer-insects-synth.wav',s)
noise=rng.normal(0,1,len(t));wind=np.convolve(noise,np.ones(110)/110,mode='same')*2.3
wind*=.35+.2*np.sin(t*.14)+.1*np.sin(t*.87);save('wind-synth.wav',wind)
water=np.convolve(noise,np.ones(6)/6,mode='same')*.24+np.convolve(rng.normal(0,1,len(t)),np.ones(38)/38,mode='same')*.52
water*=.7+.12*np.sin(t*.83)+.08*np.sin(t*2.4);save('stream-synth.wav',water)
print('3 original 53-second mono PCM files written; synthesized, not field recordings.')

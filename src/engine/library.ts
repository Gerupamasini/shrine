import * as T from "three";
import { publicUrl } from "../urls";
import { patchAtmosphere } from "./atmosphere";

export type PbrDef = {
  /** texture set id under assets/textures (Poly Haven id or derived) */
  tex?: string;
  /** metres covered by one texture repeat (UVs are authored in metres) */
  size?: number;
  color?: string;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  side?: T.Side;
  alphaTest?: number;
  map?: string;
  envIntensity?: number;
};

/**
 * Shared texture + material registry. Materials that receive shadows from the
 * cascaded shadow map must be passed through `finish` (CSM + atmosphere).
 */
export class Library {
  loader = new T.TextureLoader();
  textures = new Map<string, T.Texture>();
  pending: Promise<unknown>[] = [];
  materials = new Map<string, T.Material>();
  finishers: ((m: T.Material) => void)[] = [];
  anisotropy: number;
  constructor(public renderer: T.WebGLRenderer) {
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  texture(path: string, srgb: boolean, repeat = true) {
    const key = path + (srgb ? "#s" : "#l");
    let t = this.textures.get(key);
    if (t) return t;
    t = this.loader.load(publicUrl(path));
    this.pending.push(
      new Promise((res) => {
        const img = t!;
        const check = () => (img.image && (img.image as HTMLImageElement).complete ? res(0) : setTimeout(check, 30));
        check();
      }),
    );
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = this.anisotropy;
    this.textures.set(key, t);
    return t;
  }
  set(id: string) {
    const base = `assets/textures/${id}/`;
    return {
      map: this.texture(base + "albedo.jpg", true),
      normal: this.texture(base + "normal.jpg", false),
      arm: this.texture(base + "arm.jpg", false),
    };
  }
  pbr(def: PbrDef) {
    const m = new T.MeshStandardMaterial({
      color: def.color ?? 0xffffff,
      roughness: def.roughness ?? 1,
      metalness: def.metalness ?? 0,
      side: def.side ?? T.FrontSide,
    });
    if (def.tex) {
      const s = this.set(def.tex);
      const rep = 1 / (def.size ?? 1);
      const clone = (t: T.Texture) => {
        if (rep === 1) return t;
        const c = t.clone();
        c.repeat.set(rep, rep);
        c.needsUpdate = true;
        return c;
      };
      m.map = clone(s.map);
      m.normalMap = clone(s.normal);
      m.normalScale.setScalar(def.normalScale ?? 1);
      const arm = clone(s.arm);
      m.aoMap = arm;
      m.aoMapIntensity = 0.85;
      m.roughnessMap = arm;
      m.metalnessMap = def.metalness ? arm : null;
    }
    if (def.alphaTest) m.alphaTest = def.alphaTest;
    if (def.envIntensity !== undefined) m.envMapIntensity = def.envIntensity;
    return this.finish(m);
  }
  finish<M extends T.Material>(m: M): M {
    for (const f of this.finishers) f(m);
    patchAtmosphere(m);
    return m;
  }
  async ready() {
    await Promise.all(this.pending);
  }
}
